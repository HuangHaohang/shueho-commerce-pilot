import "dotenv/config";

import { Client } from "pg";

import { config } from "./config.js";
import { syncProviderMarketProfiles } from "./market-profiles.js";

if (!config.migrationDatabaseUrl) throw new Error("EXTERNAL_DATA_MIGRATION_DATABASE_URL is required.");

const client = new Client({
  connectionString: config.migrationDatabaseUrl,
  application_name: "external-data-market-profile-importer",
});
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('justoneapi-market-profile-import'))");
  const catalog = await client.query<{ id: string }>(`
    SELECT id FROM provider_catalog_import_receipt
    WHERE provider='justoneapi' ORDER BY created_at DESC LIMIT 1
  `);
  const catalogReceiptId = catalog.rows[0]?.id;
  if (!catalogReceiptId) throw new Error("No provider catalog import receipt is available.");
  const result = await syncProviderMarketProfiles(client,catalogReceiptId);
  await client.query("COMMIT");
  console.log(JSON.stringify({ ok: true,catalogReceiptId,...result },null,2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
