import nextEnv from "@next/env";
import { config as loadDotenv } from "dotenv";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

nextEnv.loadEnvConfig(process.cwd());
loadDotenv({ path: resolve(process.cwd(), ".env.migration"), override: false, quiet: true });

const applicationUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!applicationUrl || !migrationUrl || applicationUrl === migrationUrl) {
  throw new Error("Isolation verification requires distinct DATABASE_URL and MIGRATION_DATABASE_URL values.");
}

const suffix = randomUUID();
const userA = `rls-a-${suffix}`;
const userB = `rls-b-${suffix}`;
const organizationA = randomUUID();
const organizationB = randomUUID();
const tenantA = randomUUID();
const tenantB = randomUUID();
const workspaceA1 = randomUUID();
const workspaceA2 = randomUUID();
const workspaceB = randomUUID();
const owner = new Pool({ connectionString: migrationUrl, max: 1 });
const application = new Pool({ connectionString: applicationUrl, max: 1 });

try {
  await createFixtures();
  const role = await application.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
  );
  assert(role.rows[0]?.rolsuper === false && role.rows[0]?.rolbypassrls === false, "application role bypasses RLS");

  const unscoped = await application.query<{ count: string }>(`SELECT count(*)::text AS count FROM commerce_tenant`);
  assert(unscoped.rows[0]?.count === "0", "unscoped tenant rows were visible");

  const selfClient = await application.connect();
  try {
    await selfClient.query("BEGIN");
    await selfClient.query("SELECT set_config('commerce.user_id', $1, true)", [userA]);
    const ownMemberships = await selfClient.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM commerce_tenant_membership WHERE user_id = $1`,
      [userA],
    );
    assert(ownMemberships.rows[0]?.count === "1", "self membership discovery failed");
    const otherMemberships = await selfClient.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM commerce_tenant_membership WHERE user_id = $1`,
      [userB],
    );
    assert(otherMemberships.rows[0]?.count === "0", "another user's membership was visible");
    await selfClient.query("ROLLBACK");
  } finally {
    selfClient.release();
  }

  const scoped = await application.connect();
  try {
    await scoped.query("BEGIN");
    await setScope(scoped, tenantA, workspaceA1, userA, false);
    await scoped.query("SELECT set_config('commerce.organization_id', $1, true)", [organizationA]);
    assert(await count(scoped, `SELECT count(*)::text AS count FROM commerce_tenant`) === 1, "tenant scope leaked");
    assert(await count(scoped, `SELECT count(*)::text AS count FROM commerce_workspace`) === 1, "workspace scope leaked");
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_tenant WHERE id = $1`, [tenantB]) === 0,
      "cross-tenant row was visible",
    );
    assert(await count(scoped, `SELECT count(*)::text AS count FROM commerce_organization`) === 1, "organization scope failed");
    await scoped.query(
      `INSERT INTO commerce_agent_thread
        (thread_id, user_id, created_by_user_id, tenant_id, workspace_id, title)
       VALUES ($1, $2, $2, $3, $4, 'RLS verification')`,
      [`thread-${suffix}`, userA, tenantA, workspaceA1],
    );
    await scoped.query("SAVEPOINT cross_tenant_write");
    let crossTenantWriteRejected = false;
    try {
      await scoped.query(
        `INSERT INTO commerce_agent_thread
          (thread_id, user_id, created_by_user_id, tenant_id, workspace_id, title)
         VALUES ($1, $2, $2, $3, $4, 'must fail')`,
        [`forbidden-${suffix}`, userA, tenantB, workspaceB],
      );
    } catch {
      crossTenantWriteRejected = true;
      await scoped.query("ROLLBACK TO SAVEPOINT cross_tenant_write");
    }
    assert(crossTenantWriteRejected, "cross-tenant write was accepted");
    await scoped.query("SELECT set_config('commerce.tenant_wide', 'on', true)");
    assert(await count(scoped, `SELECT count(*)::text AS count FROM commerce_workspace`) === 2, "tenant-wide workspace scope failed");
    await scoped.query(
      `INSERT INTO commerce_agent_turn_lease
        (tenant_id, workspace_id, user_id, thread_id, request_id, state, expires_at)
       VALUES ($1, $2, $3, 'thread-a', $4, 'active', CURRENT_TIMESTAMP + interval '5 minutes'),
              ($1, $5, $3, 'thread-b', $6, 'active', CURRENT_TIMESTAMP + interval '5 minutes')`,
      [tenantA, workspaceA1, userA, randomUUID(), workspaceA2, randomUUID()],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_turn_lease WHERE tenant_id = $1`, [tenantA]) === 2,
      "tenant-wide lease aggregate did not span workspaces",
    );
    await scoped.query("ROLLBACK");
  } finally {
    scoped.release();
  }

  console.log(JSON.stringify({ ok: true, applicationRole: "non-superuser/non-BYPASSRLS", checks: 9 }));
} finally {
  await owner.query(`DELETE FROM commerce_organization WHERE id = ANY($1::uuid[])`, [[organizationA, organizationB]]).catch(() => undefined);
  await owner.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [[userA, userB]]).catch(() => undefined);
  await Promise.all([owner.end(), application.end()]);
}

async function createFixtures(): Promise<void> {
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "user" (id, name, email, "emailVerified")
       VALUES ($1, 'RLS A', $2, true), ($3, 'RLS B', $4, true)`,
      [userA, `${userA}@example.test`, userB, `${userB}@example.test`],
    );
    await client.query(
      `INSERT INTO commerce_organization (id, slug, name, status, created_by_user_id)
       VALUES ($1, $2, 'RLS A', 'active', $3), ($4, $5, 'RLS B', 'active', $6)`,
      [organizationA, `rls-a-${suffix}`, userA, organizationB, `rls-b-${suffix}`, userB],
    );
    await client.query(
      `INSERT INTO commerce_tenant (id, organization_id, slug, name, status, created_by_user_id)
       VALUES ($1, $2, $3, 'RLS A', 'active', $4), ($5, $6, $7, 'RLS B', 'active', $8)`,
      [tenantA, organizationA, `rls-a-${suffix}`, userA, tenantB, organizationB, `rls-b-${suffix}`, userB],
    );
    await client.query(
      `INSERT INTO commerce_workspace (id, tenant_id, slug, name, status, is_default, created_by_user_id)
       VALUES ($1, $2, 'default', 'A1', 'active', true, $3),
              ($4, $2, 'secondary', 'A2', 'active', false, $3),
              ($5, $6, 'default', 'B1', 'active', true, $7)`,
      [workspaceA1, tenantA, userA, workspaceA2, workspaceB, tenantB, userB],
    );
    await client.query(
      `INSERT INTO commerce_tenant_membership (tenant_id, user_id, status, is_default, joined_at)
       VALUES ($1, $2, 'active', true, CURRENT_TIMESTAMP), ($3, $4, 'active', true, CURRENT_TIMESTAMP)`,
      [tenantA, userA, tenantB, userB],
    );
    await client.query(
      `INSERT INTO commerce_workspace_membership (tenant_id, workspace_id, user_id, status, is_default)
       VALUES ($1, $2, $3, 'active', true), ($1, $4, $3, 'active', false),
              ($5, $6, $7, 'active', true)`,
      [tenantA, workspaceA1, userA, workspaceA2, tenantB, workspaceB, userB],
    );
    await client.query(
      `INSERT INTO commerce_enterprise_contract
        (tenant_id, status, seat_limit, workspace_limit, concurrent_turn_limit,
         concurrent_turn_limit_per_workspace, concurrent_turn_limit_per_user)
       VALUES ($1, 'active', 10, 5, 4, 3, 2), ($2, 'active', 10, 5, 4, 3, 2)`,
      [tenantA, tenantB],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setScope(
  client: PoolClient,
  tenantId: string,
  workspaceId: string,
  userId: string,
  tenantWide: boolean,
): Promise<void> {
  await client.query("SELECT set_config('commerce.tenant_id', $1, true)", [tenantId]);
  await client.query("SELECT set_config('commerce.workspace_id', $1, true)", [workspaceId]);
  await client.query("SELECT set_config('commerce.user_id', $1, true)", [userId]);
  await client.query("SELECT set_config('commerce.tenant_wide', $1, true)", [tenantWide ? "on" : "off"]);
}

async function count(client: PoolClient, sql: string, values: unknown[] = []): Promise<number> {
  const result = await client.query<{ count: string }>(sql, values);
  return Number.parseInt(result.rows[0]?.count || "0", 10);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Enterprise isolation verification failed: ${message}`);
}
