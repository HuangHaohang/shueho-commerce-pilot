import { getMigrations } from "better-auth/db/migration";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

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
  console.log("Commerce Agent thread ownership schema is up to date.");
}

try {
  await main();
} finally {
  const { getAuthDatabase } = await import("../lib/auth/database");
  await getAuthDatabase().end();
}
