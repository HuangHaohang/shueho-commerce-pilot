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
    {
      version: "20260824_012_model_generated_thread_titles",
      path: resolve(process.cwd(), "migrations/012_model_generated_thread_titles.sql"),
    },
    {
      version: "20260824_013_task_recipe_metadata",
      path: resolve(process.cwd(), "migrations/013_task_recipe_metadata.sql"),
    },
    {
      version: "20260824_014_task_categories",
      path: resolve(process.cwd(), "migrations/014_task_categories.sql"),
    },
    {
      version: "20260825_015_user_input_answer_history",
      path: resolve(process.cwd(), "migrations/015_user_input_answer_history.sql"),
    },
    {
      version: "20260825_016_thread_deletion_jobs",
      path: resolve(process.cwd(), "migrations/016_thread_deletion_jobs.sql"),
    },
    {
      version: "20260825_017_task_category_correction",
      path: resolve(process.cwd(), "migrations/017_task_category_correction.sql"),
    },
    {
      version: "20260826_018_external_data_governance",
      path: resolve(process.cwd(), "migrations/018_external_data_governance.sql"),
    },
    {
      version: "20260826_019_mcp_token_auth_function_fix",
      path: resolve(process.cwd(), "migrations/019_mcp_token_auth_function_fix.sql"),
    },
    {
      version: "20260826_020_external_data_retention",
      path: resolve(process.cwd(), "migrations/020_external_data_retention.sql"),
    },
    {
      version: "20260826_021_external_data_turn_limits",
      path: resolve(process.cwd(), "migrations/021_external_data_turn_limits.sql"),
    },
    {
      version: "20260826_022_justoneapi_pricing_catalog",
      path: resolve(process.cwd(), "migrations/022_justoneapi_pricing_catalog.sql"),
    },
    {
      version: "20260826_023_provider_unavailable_price",
      path: resolve(process.cwd(), "migrations/023_provider_unavailable_price.sql"),
    },
    {
      version: "20260826_024_provider_catalog_policy_defaults",
      path: resolve(process.cwd(), "migrations/024_provider_catalog_policy_defaults.sql"),
    },
    {
      version: "20260826_025_provider_catalog_read_only",
      path: resolve(process.cwd(), "migrations/025_provider_catalog_read_only.sql"),
    },
    {
      version: "20260826_026_agent_message_feedback",
      path: resolve(process.cwd(), "migrations/026_agent_message_feedback.sql"),
    },
    {
      version: "20260826_027_external_data_archive",
      path: resolve(process.cwd(), "migrations/027_external_data_archive.sql"),
    },
    {
      version: "20260826_028_external_data_archive_sql_only",
      path: resolve(process.cwd(), "migrations/028_external_data_archive_sql_only.sql"),
    },
    {
      version: "20260826_029_external_data_search_v1_sql_view",
      path: resolve(process.cwd(), "migrations/029_external_data_search_v1_sql_view.sql"),
    },
    {
      version: "20260826_030_external_data_archive_provider_metadata",
      path: resolve(process.cwd(), "migrations/030_external_data_archive_provider_metadata.sql"),
    },
    {
      version: "20260826_031_external_data_warehouse_receipt",
      path: resolve(process.cwd(), "migrations/031_external_data_warehouse_receipt.sql"),
    },
    {
      version: "20260828_032_agent_tool_contract_version",
      path: resolve(process.cwd(), "migrations/032_agent_tool_contract_version.sql"),
    },
    {
      version: "20260828_033_external_data_plan_lineage",
      path: resolve(process.cwd(), "migrations/033_external_data_plan_lineage.sql"),
    },
    {
      version: "20260830_034_creative_project_recipe",
      path: resolve(process.cwd(), "migrations/034_creative_project_recipe.sql"),
    },
    {
      version: "20260830_035_product_catalog_foundation",
      path: resolve(process.cwd(), "migrations/035_product_catalog_foundation.sql"),
    },
    {
      version: "20260830_036_product_catalog_context",
      path: resolve(process.cwd(), "migrations/036_product_catalog_context.sql"),
    },
    {
      version: "20260830_037_product_catalog_delete_immutability",
      path: resolve(process.cwd(), "migrations/037_product_catalog_delete_immutability.sql"),
    },
    {
      version: "20260830_038_product_connector_registry",
      path: resolve(process.cwd(), "migrations/038_product_connector_registry.sql"),
    },
    {
      version: "20260830_039_product_onboarding_recipe",
      path: resolve(process.cwd(), "migrations/039_product_onboarding_recipe.sql"),
    },
    {
      version: "20260830_040_enterprise_data_isolation_closure",
      path: resolve(process.cwd(), "migrations/040_enterprise_data_isolation_closure.sql"),
    },
    {
      version: "20260830_041_product_operator_file_import",
      path: resolve(process.cwd(), "migrations/041_product_operator_file_import.sql"),
    },
    {
      version: "20260830_042_product_secret_handles_and_storage_governance",
      path: resolve(process.cwd(), "migrations/042_product_secret_handles_and_storage_governance.sql"),
    },
    {
      version: "20260830_043_product_mapping_operation_idempotency",
      path: resolve(process.cwd(), "migrations/043_product_mapping_operation_idempotency.sql"),
    },
    {
      version: "20260831_044_product_insight_recipes",
      path: resolve(process.cwd(), "migrations/044_product_insight_recipes.sql"),
    },
    {
      version: "20260831_045_creative_infinite_canvas",
      path: resolve(process.cwd(), "migrations/045_creative_infinite_canvas.sql"),
    },
    {
      version: "20260831_046_creative_canvas_revision_history",
      path: resolve(process.cwd(), "migrations/046_creative_canvas_revision_history.sql"),
    },
    {
      version: "20260831_047_creative_canvas_reconciliation_delete",
      path: resolve(process.cwd(), "migrations/047_creative_canvas_reconciliation_delete.sql"),
    },
    {
      version: "20260901_048_creative_campaign_review_methods",
      path: resolve(process.cwd(), "migrations/048_creative_campaign_review_methods.sql"),
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
