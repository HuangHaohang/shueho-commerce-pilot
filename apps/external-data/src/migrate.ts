import "dotenv/config";

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import { config } from "./config.js";

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const connectionString = config.migrationDatabaseUrl;
if (!connectionString) throw new Error("EXTERNAL_DATA_MIGRATION_DATABASE_URL is required.");

const client = new Client({ connectionString, application_name: "shueho-external-data-migration" });
await client.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS external_data_schema_migration (
      version text PRIMARY KEY,
      sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
    const sha256 = createHash("sha256").update(sql, "utf8").digest("hex");
    const existing = await client.query<{ sha256: string }>(
      "SELECT sha256 FROM external_data_schema_migration WHERE version = $1",
      [file],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].sha256 !== sha256) throw new Error(`Applied migration ${file} was modified.`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO external_data_schema_migration (version, sha256) VALUES ($1, $2)",
        [file, sha256],
      );
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}
