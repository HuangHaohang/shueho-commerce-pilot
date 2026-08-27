import nextEnv from "@next/env";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

nextEnv.loadEnvConfig(process.cwd());
loadDotenv({ path: resolve(process.cwd(), ".env"), override: false, quiet: true });

const tenantId = process.env.COMMERCE_RUNTIME_TENANT_ID?.trim();
if (!tenantId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(tenantId)) {
  throw new Error("COMMERCE_RUNTIME_TENANT_ID is required for the external-data retention worker.");
}
const intervalMs = parseInteger(
  process.env.COMMERCE_EXTERNAL_DATA_RETENTION_INTERVAL_MS || "21600000",
  60_000,
  86_400_000,
);
const batchSize = parseInteger(
  process.env.COMMERCE_EXTERNAL_DATA_RETENTION_BATCH_SIZE || "500",
  1,
  5_000,
);

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const { getAuthDatabase } = await import("../lib/auth/database");

try {
  while (!stopping) {
    const deleted = await purgeBatch();
    if (deleted.archives > 0 || deleted.calls > 0) {
      console.log(JSON.stringify({ event: "external_data_retention", tenantId, ...deleted }));
      continue;
    }
    await sleep(intervalMs);
  }
} finally {
  await getAuthDatabase().end();
}

async function purgeBatch(): Promise<{ archives: number; calls: number }> {
  const client = await getAuthDatabase().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('commerce.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('commerce.tenant_wide', 'on', true)");
    const archives = await client.query<{ deleted: number }>(
      `SELECT commerce_purge_external_data_archives($1) AS deleted`,
      [batchSize],
    );
    const calls = await client.query<{ deleted: number }>(
      `SELECT commerce_purge_external_data_calls($1) AS deleted`,
      [batchSize],
    );
    await client.query("COMMIT");
    return {
      archives: archives.rows[0]?.deleted ?? 0,
      calls: calls.rows[0]?.deleted ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    const timer = setTimeout(resolveSleep, ms);
    const poll = setInterval(() => {
      if (!stopping) return;
      clearTimeout(timer);
      clearInterval(poll);
      resolveSleep();
    }, 250);
  });
}

function parseInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid external-data retention configuration: ${value}`);
  }
  return parsed;
}
