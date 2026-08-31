import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const tenantId = process.env.COMMERCE_RUNTIME_TENANT_ID?.trim();
if (!tenantId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(tenantId)) {
  throw new Error("COMMERCE_RUNTIME_TENANT_ID is required for the product-import retention worker.");
}
const intervalMs = parseInteger(process.env.COMMERCE_PRODUCT_RETENTION_INTERVAL_MS ?? "21600000", 60_000, 86_400_000);
const batchSize = parseInteger(process.env.COMMERCE_PRODUCT_RETENTION_BATCH_SIZE ?? "100", 1, 1_000);
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const { getAuthDatabase } = await import("../lib/auth/database");
try {
  while (!stopping) {
    const client = await getAuthDatabase().connect();
    let result = { purgedImports: 0, purgedRecords: 0, releasedBytes: 0 };
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('commerce.tenant_id',$1,true)", [tenantId]);
      await client.query("SELECT set_config('commerce.tenant_wide','on',true)");
      const purged = await client.query<{
        purged_imports: number;
        purged_records: number;
        released_bytes: string;
      }>(`SELECT * FROM commerce_purge_product_import_payloads($1)`, [batchSize]);
      await client.query("COMMIT");
      result = {
        purgedImports: purged.rows[0]?.purged_imports ?? 0,
        purgedRecords: purged.rows[0]?.purged_records ?? 0,
        releasedBytes: Number(purged.rows[0]?.released_bytes ?? 0),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (result.purgedImports > 0) {
      console.log(JSON.stringify({ event: "product_import_retention", tenantId, ...result }));
      continue;
    }
    await sleep(intervalMs);
  }
} finally {
  await getAuthDatabase().end();
}

function parseInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid product-import retention configuration: ${value}`);
  }
  return parsed;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
