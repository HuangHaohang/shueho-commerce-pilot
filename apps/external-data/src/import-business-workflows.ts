import "dotenv/config";

import { Client } from "pg";

import { syncProviderBusinessWorkflows } from "./business-workflows.js";
import { config } from "./config.js";
import type { JsonObject } from "./types.js";

if (!config.migrationDatabaseUrl) throw new Error("EXTERNAL_DATA_MIGRATION_DATABASE_URL is required.");

const client = new Client({
  connectionString: config.migrationDatabaseUrl,
  application_name: "external-data-business-workflow-importer",
});
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('justoneapi-business-workflow-import'))");
  const catalog = await client.query<{ id: string }>(`
    SELECT id FROM provider_catalog_import_receipt
    WHERE provider='justoneapi' ORDER BY created_at DESC LIMIT 1
  `);
  const catalogReceiptId = catalog.rows[0]?.id;
  if (!catalogReceiptId) throw new Error("No provider catalog import receipt is available.");
  const endpoints = await client.query<{
    endpoint_id: string; platform_id: string; enabled: boolean; request_schema: JsonObject;
  }>(`
    SELECT endpoint_id,platform_id,enabled,request_schema
    FROM provider_endpoint WHERE provider='justoneapi'
    ORDER BY endpoint_id
  `);
  const result = await syncProviderBusinessWorkflows(client,catalogReceiptId,endpoints.rows.map((row) => ({
    endpointId: row.endpoint_id,
    platformId: row.platform_id,
    enabled: row.enabled,
    requestSchema: row.request_schema,
  })));
  await client.query("COMMIT");
  console.log(JSON.stringify({ ok: true,catalogReceiptId,...result },null,2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
