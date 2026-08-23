import { getMigrations } from "better-auth/db/migration";
import nextEnv from "@next/env";
import { config as loadDotenv } from "dotenv";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

nextEnv.loadEnvConfig(process.cwd());
loadDotenv({ path: resolve(process.cwd(), ".env.migration"), override: false, quiet: true });
const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
if (process.env.NODE_ENV === "production" && !migrationDatabaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required in production and must be separate from the web runtime role.");
}
if (migrationDatabaseUrl) process.env.DATABASE_URL = migrationDatabaseUrl;
process.env.COMMERCE_DATABASE_ROLE_MODE = "migration";

async function main() {
  const { authOptions } = await import("../lib/auth");
  const migration = await getMigrations(authOptions);
  const changeCount =
    migration.toBeCreated.length + migration.toBeAdded.length + migration.toBeAddedIndexes.length;

  if (migration.unsafeChanges.length > 0) {
    throw new Error(`Unsafe authentication migration:\n${migration.unsafeChanges.join("\n")}`);
  }

  if (changeCount === 0) {
    console.log("Authentication schema is up to date.");
  } else {
    await migration.runMigrations();
    console.log(
      `Authentication migration complete: ${migration.toBeCreated.length} tables created, ${migration.toBeAdded.length} table alterations, ${migration.toBeAddedIndexes.length} indexes added.`,
    );
  }

  const { getAuthDatabase } = await import("../lib/auth/database");
  await getAuthDatabase().query(`
    CREATE TABLE IF NOT EXISTS commerce_agent_thread (
      thread_id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await getAuthDatabase().query(`
    CREATE INDEX IF NOT EXISTS commerce_agent_thread_user_id_idx
    ON commerce_agent_thread(user_id)
  `);
  await getAuthDatabase().query(`
    ALTER TABLE commerce_agent_thread
    ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '新任务'
  `);
  await getAuthDatabase().query(`
    ALTER TABLE commerce_agent_thread
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
  await getAuthDatabase().query(`
    CREATE INDEX IF NOT EXISTS commerce_agent_thread_user_updated_idx
    ON commerce_agent_thread(user_id, updated_at DESC)
  `);
  await getAuthDatabase().query(`
    ALTER TABLE commerce_agent_thread
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'
  `);
  await getAuthDatabase().query(`
    ALTER TABLE commerce_agent_thread
    ADD COLUMN IF NOT EXISTS active_turn_id text
  `);
  await getAuthDatabase().query(`
    ALTER TABLE commerce_agent_thread
    ADD COLUMN IF NOT EXISTS turn_started_at timestamptz
  `);
  await getAuthDatabase().query(`
    ALTER TABLE commerce_agent_thread
    ADD COLUMN IF NOT EXISTS duration_ms integer
  `);
  await runCommerceMigrations();
  console.log("Commerce Agent thread ownership schema is up to date.");
}

async function runCommerceMigrations(): Promise<void> {
  const { getAuthDatabase } = await import("../lib/auth/database");
  const database = getAuthDatabase();
  await database.query(`
    CREATE TABLE IF NOT EXISTS commerce_schema_migration (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrations = [
    {
      version: "20260823_001_enterprise_foundation",
      path: resolve(process.cwd(), "migrations/001_enterprise_foundation.sql"),
    },
    {
      version: "20260823_002_enterprise_isolation_hardening",
      path: resolve(process.cwd(), "migrations/002_enterprise_isolation_hardening.sql"),
    },
    {
      version: "20260823_003_enterprise_security_hardening",
      path: resolve(process.cwd(), "migrations/003_enterprise_security_hardening.sql"),
    },
    {
      version: "20260823_004_provider_usage_attribution",
      path: resolve(process.cwd(), "migrations/004_provider_usage_attribution.sql"),
    },
    {
      version: "20260823_005_enterprise_control_plane_rls",
      path: resolve(process.cwd(), "migrations/005_enterprise_control_plane_rls.sql"),
    },
    {
      version: "20260823_006_usage_and_invitation_hardening",
      path: resolve(process.cwd(), "migrations/006_usage_and_invitation_hardening.sql"),
    },
    {
      version: "20260823_007_concurrency_budget_reservations",
      path: resolve(process.cwd(), "migrations/007_concurrency_budget_reservations.sql"),
    },
    {
      version: "20260823_008_enterprise_administration",
      path: resolve(process.cwd(), "migrations/008_enterprise_administration.sql"),
    },
    {
      version: "20260823_009_enterprise_rate_limits",
      path: resolve(process.cwd(), "migrations/009_enterprise_rate_limits.sql"),
    },
    {
      version: "20260823_010_role_contract_alignment",
      path: resolve(process.cwd(), "migrations/010_role_contract_alignment.sql"),
    },
    {
      version: "20260823_011_usage_reconciliation_and_role_cleanup",
      path: resolve(process.cwd(), "migrations/011_usage_reconciliation_and_role_cleanup.sql"),
    },
  ];

  for (const migration of migrations) {
    const sql = await readFile(migration.path, "utf8");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["commerce_schema_migration"]);
      const existing = await client.query(
        "SELECT 1 FROM commerce_schema_migration WHERE version = $1",
        [migration.version],
      );
      if (existing.rowCount === 0) {
        await client.query(sql);
        await client.query("INSERT INTO commerce_schema_migration (version) VALUES ($1)", [migration.version]);
        console.log(`Applied Commerce migration ${migration.version}.`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

try {
  await main();
} finally {
  const { getAuthDatabase } = await import("../lib/auth/database");
  await getAuthDatabase().end();
}
