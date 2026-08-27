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
const roleA = randomUUID();
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
  const providerPrivileges = await application.query<{
    can_select: boolean;
    can_insert: boolean;
    can_delete_archive: boolean;
    can_read_archive_view: boolean;
  }>(
    `SELECT has_table_privilege(current_user, 'commerce_external_provider_endpoint', 'SELECT') AS can_select,
            has_table_privilege(current_user, 'commerce_external_provider_endpoint', 'INSERT') AS can_insert,
            has_table_privilege(current_user, 'commerce_external_data_archive', 'DELETE') AS can_delete_archive,
            has_table_privilege(current_user, 'commerce_external_data_search_v1_archive', 'SELECT') AS can_read_archive_view`,
  );
  assert(providerPrivileges.rows[0]?.can_select === true, "application role cannot read provider master data");
  assert(providerPrivileges.rows[0]?.can_insert === false, "application role can mutate provider master data");
  assert(providerPrivileges.rows[0]?.can_delete_archive === false, "application role can directly delete SQL-only archives");
  assert(providerPrivileges.rows[0]?.can_read_archive_view === false, "application role can read the SQL-only archive view");

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
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_policy`) === 1,
      "external data policy leaked outside the selected workspace",
    );
    const mcpTokenId = randomUUID();
    await scoped.query(
      `INSERT INTO commerce_mcp_access_token
        (id, tenant_id, workspace_id, created_by_user_id, name, token_prefix, token_hash, scopes)
       VALUES ($1, $2, $3, $4, 'RLS token', 'cp_12345678', decode($5, 'hex'),
               ARRAY['external_data.catalog.read']::text[])`,
      [mcpTokenId, tenantA, workspaceA1, userA, "ab".repeat(32)],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_mcp_access_token`) === 1,
      "workspace MCP token was not visible in scope",
    );
    assert(
      await count(
        scoped,
        `SELECT count(*)::text AS count FROM commerce_authenticate_mcp_access_token($1, $2)`,
        ["cp_12345678", "ab".repeat(32)],
      ) === 1,
      "valid MCP token digest did not authenticate",
    );
    assert(
      await count(
        scoped,
        `SELECT count(*)::text AS count FROM commerce_authenticate_mcp_access_token($1, $2)`,
        ["cp_12345678", "ef".repeat(32)],
      ) === 0,
      "invalid MCP token digest authenticated",
    );
    await scoped.query(
      `INSERT INTO commerce_external_data_call
        (tenant_id, workspace_id, user_id, provider, source, root_thread_id,
         thread_id, turn_id, call_id, endpoint_id, platform, parameter_hash,
         requested_approval_mode, approval_state, state)
       VALUES ($1, $2, $3, 'justoneapi', 'codex_harness', $4,
               $4, 'turn-12345678', 'call-12345678', 'taobao.test_v1', 'taobao', $5,
               'always_ask', 'pending', 'reserved')`,
      [tenantA, workspaceA1, userA, `thread-${suffix}`, "cd".repeat(32)],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_call`) === 1,
      "external data call ledger was not visible in scope",
    );
    const archiveThreadId = `archive-${suffix}`;
    await scoped.query(
      `INSERT INTO commerce_agent_thread
        (thread_id, user_id, created_by_user_id, tenant_id, workspace_id, title)
       VALUES ($1, $2, $2, $3, $4, 'Archive RLS verification')`,
      [archiveThreadId, userA, tenantA, workspaceA1],
    );
    await scoped.query(
      `INSERT INTO commerce_external_data_archive (
         tenant_id, workspace_id, user_id, source, source_call_id,
         endpoint_id, platform, root_thread_id, thread_id, turn_id,
         state, request_payload, response_payload,
         request_sha256, response_sha256, request_bytes, response_bytes,
         upstream_code, completed_at
       ) VALUES (
         $1, $2, $3, 'codex_harness', 'archive-call-12345678',
         'search.search_v1', 'search', $4, $4, 'turn-archive-1234',
         'succeeded', $5::jsonb, $6::jsonb, $7, $8,
         octet_length($5::text), octet_length($6::text), 0, CURRENT_TIMESTAMP
       )`,
      [
        tenantA,
        workspaceA1,
        userA,
        archiveThreadId,
        JSON.stringify({ endpoint_id: "search.search_v1", params: { keyword: "通勤包" } }),
        JSON.stringify({ code: 0, data: [{ title: "验证" }], message: null, recordTime: new Date().toISOString() }),
        "9a".repeat(32),
        "bc".repeat(32),
      ],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_archive`) === 1,
      "external data archive was not visible to its creator",
    );
    await scoped.query(`DELETE FROM commerce_agent_thread WHERE thread_id = $1`, [archiveThreadId]);
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_archive`) === 1,
      "thread deletion cascaded into the independent external data archive",
    );
    await scoped.query(
      `INSERT INTO commerce_external_data_call
        (tenant_id, workspace_id, user_id, provider, source, root_thread_id,
         thread_id, turn_id, call_id, endpoint_id, platform, parameter_hash,
         requested_approval_mode, approval_state, state, created_at, completed_at)
       VALUES
         ($1, $2, $3, 'justoneapi', 'codex_harness', $4, $4, 'turn-old-1234',
          'call-old-success', 'taobao.old_v1', 'taobao', $5,
          'task', 'not_required', 'succeeded', CURRENT_TIMESTAMP - interval '800 days', CURRENT_TIMESTAMP - interval '800 days'),
         ($1, $2, $3, 'justoneapi', 'codex_harness', $4, $4, 'turn-old-5678',
          'call-old-unknown', 'taobao.unknown_v1', 'taobao', $6,
          'task', 'not_required', 'unknown', CURRENT_TIMESTAMP - interval '800 days', CURRENT_TIMESTAMP - interval '800 days')`,
      [tenantA, workspaceA1, userA, `thread-${suffix}`, "12".repeat(32), "34".repeat(32)],
    );
    const purged = await scoped.query<{ deleted: number }>(
      `SELECT commerce_purge_external_data_calls(100) AS deleted`,
    );
    assert(purged.rows[0]?.deleted === 1, "retention worker did not purge exactly one eligible terminal call");
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_call WHERE state = 'unknown'`) === 1,
      "retention worker removed an unresolved external data call",
    );
    await scoped.query(
      `INSERT INTO commerce_agent_user_input_answer
        (tenant_id, workspace_id, user_id, thread_id, turn_id, request_id, item_id, answer_message)
       VALUES ($1, $2, $3, $4, 'turn-12345678', 'request-1', 'item-1', '我的选择：\n发布渠道：小红书')`,
      [tenantA, workspaceA1, userA, `thread-${suffix}`],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_user_input_answer`) === 1,
      "thread owner could not read the user-input answer index",
    );
    await scoped.query(
      `INSERT INTO commerce_agent_message_feedback
        (tenant_id, workspace_id, user_id, thread_id, turn_id,
         message_item_id, rating, message_content_hash, model)
       VALUES ($1, $2, $3, $4, 'turn-12345678',
               'message-feedback-1', 'positive', $5, 'gpt-5.6-luna')`,
      [tenantA, workspaceA1, userA, `thread-${suffix}`, "56".repeat(32)],
    );
    await scoped.query(
      `INSERT INTO commerce_agent_message_feedback_event
        (tenant_id, workspace_id, user_id, thread_id, turn_id,
         message_item_id, action, rating, message_content_hash, model)
       VALUES ($1, $2, $3, $4, 'turn-12345678',
               'message-feedback-1', 'set', 'positive', $5, 'gpt-5.6-luna')`,
      [tenantA, workspaceA1, userA, `thread-${suffix}`, "56".repeat(32)],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback`) === 1,
      "thread owner could not read current message feedback",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback_event`) === 1,
      "thread owner could not read message feedback events",
    );
    const deletionJobId = randomUUID();
    await scoped.query(
      `INSERT INTO commerce_thread_deletion_job
        (id, tenant_id, workspace_id, user_id, total_items)
       VALUES ($1, $2, $3, $4, 1)`,
      [deletionJobId, tenantA, workspaceA1, userA],
    );
    await scoped.query(
      `INSERT INTO commerce_thread_deletion_item
        (job_id, tenant_id, workspace_id, user_id, thread_id, ordinal)
       VALUES ($1, $2, $3, $4, $5, 0)`,
      [deletionJobId, tenantA, workspaceA1, userA, `thread-${suffix}`],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_thread_deletion_job`) === 1,
      "thread owner could not read the deletion job",
    );
    await scoped.query("SELECT set_config('commerce.user_id', $1, true)", [userB]);
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_user_input_answer`) === 0,
      "another user's user-input answer was visible",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_thread_deletion_job`) === 0,
      "another user's deletion job was visible",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback`) === 0,
      "another user's current message feedback was visible",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback_event`) === 0,
      "another user's message feedback events were visible",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_archive`) === 0,
      "another user's external data archive was visible",
    );
    await scoped.query("SELECT set_config('commerce.user_id', $1, true)", [userA]);
    await scoped.query(
      `DELETE FROM commerce_agent_message_feedback
       WHERE thread_id = $1 AND message_item_id = 'message-feedback-1'`,
      [`thread-${suffix}`],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback`) === 0 &&
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback_event`) === 1,
      "clearing current feedback removed the append-only feedback event",
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
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_policy`) === 2,
      "tenant-wide external data policy scope failed",
    );
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

  console.log(JSON.stringify({ ok: true, applicationRole: "non-superuser/non-BYPASSRLS", checks: 33 }));
} finally {
  await owner.query(`DELETE FROM commerce_tenant WHERE id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => undefined);
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
    await client.query(
      `INSERT INTO commerce_external_data_policy (tenant_id, workspace_id)
       VALUES ($1, $2), ($1, $3), ($4, $5)`,
      [tenantA, workspaceA1, workspaceA2, tenantB, workspaceB],
    );
    await client.query(
      `INSERT INTO commerce_enterprise_role
        (id, tenant_id, scope, role_key, name, allowed_permissions, is_system)
       VALUES ($1, $2, 'workspace', 'workspace_operator', 'RLS operator',
               ARRAY['external_data.catalog.read', 'external_data.call']::text[], true)`,
      [roleA, tenantA],
    );
    await client.query(
      `INSERT INTO commerce_user_role_assignment
        (tenant_id, user_id, role_id, workspace_id, assigned_by_user_id)
       VALUES ($1, $2, $3, $4, $2)`,
      [tenantA, userA, roleA, workspaceA1],
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
