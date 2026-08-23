import nextEnv from "@next/env";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

nextEnv.loadEnvConfig(process.cwd());
loadDotenv({ path: resolve(process.cwd(), ".env.migration"), override: false, quiet: true });
const provisioningDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
if (process.env.NODE_ENV === "production" && !provisioningDatabaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required for production Enterprise provisioning.");
}
if (provisioningDatabaseUrl) process.env.DATABASE_URL = provisioningDatabaseUrl;

const { SYSTEM_ENTERPRISE_ROLES } = await import("../lib/enterprise/permissions");
const { getAuthDatabase } = await import("../lib/auth/database");

const options = readOptions(process.argv.slice(2));
const ownerEmail = (options["owner-email"] || process.env.COMMERCE_BOOTSTRAP_OWNER_EMAIL || "")
  .trim()
  .toLowerCase();
const tenantName = (options["tenant-name"] || process.env.COMMERCE_BOOTSTRAP_TENANT_NAME || "")
  .trim();
const tenantSlug = (options["tenant-slug"] || process.env.COMMERCE_BOOTSTRAP_TENANT_SLUG || "")
  .trim()
  .toLowerCase();
const workspaceName = (options["workspace-name"] || "默认工作区").trim();
const workspaceSlug = (options["workspace-slug"] || "default").trim().toLowerCase();
const seatLimit = positiveInteger(options["seat-limit"] || "150", "seat-limit");
const workspaceLimit = positiveInteger(options["workspace-limit"] || "10", "workspace-limit");
const concurrentTurnLimit = positiveInteger(options["concurrent-turn-limit"] || "25", "concurrent-turn-limit");
const perWorkspaceLimit = positiveInteger(options["workspace-turn-limit"] || "15", "workspace-turn-limit");
const perUserLimit = positiveInteger(options["user-turn-limit"] || "3", "user-turn-limit");
const monthlyTokenLimit = positiveInteger(
  options["monthly-token-limit"] || "50000000",
  "monthly-token-limit",
);
const monthlyModelRequestLimit = positiveInteger(
  options["monthly-model-request-limit"] || "50000",
  "monthly-model-request-limit",
);
const tokenReservationPerTurn = positiveInteger(
  options["token-reservation-per-turn"] || "50000",
  "token-reservation-per-turn",
);
const maxAgentThreadsPerSession = boundedInteger(
  options["max-agent-threads-per-session"] || "4",
  "max-agent-threads-per-session",
  1,
  16,
);
const identityVerified =
  (options["identity-verified"] || process.env.COMMERCE_BOOTSTRAP_IDENTITY_VERIFIED || "false") === "true";

if (process.env.NODE_ENV === "production" && !identityVerified) {
  throw new Error(
    "Production owner provisioning requires --identity-verified=true after contract/IdP identity verification.",
  );
}

if (!/^\S+@\S+\.\S+$/.test(ownerEmail)) {
  throw new Error("Provide --owner-email for an existing Better Auth user.");
}
if (!tenantName) {
  throw new Error("Provide --tenant-name.");
}
for (const [name, value] of [["tenant-slug", tenantSlug], ["workspace-slug", workspaceSlug]] as const) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(value)) {
    throw new Error(`${name} must contain 2-63 lowercase letters, numbers, or hyphens.`);
  }
}

const database = getAuthDatabase();
const client = await database.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-bootstrap:${tenantSlug}`]);
  const user = await client.query<{ id: string }>(
    `SELECT id FROM "user" WHERE lower(email) = $1 LIMIT 1`,
    [ownerEmail],
  );
  const ownerUserId = user.rows[0]?.id;
  if (!ownerUserId) {
    throw new Error("The requested Enterprise owner does not exist in Better Auth.");
  }
  if (identityVerified) {
    await client.query(
      `UPDATE "user" SET "emailVerified" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
      [ownerUserId],
    );
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-default:${ownerUserId}`]);
  await client.query(
    `UPDATE commerce_tenant_membership SET is_default = false WHERE user_id = $1 AND is_default`,
    [ownerUserId],
  );

  const organization = await client.query<{ id: string }>(
    `
      INSERT INTO commerce_organization (slug, name, status, created_by_user_id)
      VALUES ($1, $2, 'active', $3)
      ON CONFLICT (lower(slug)) DO UPDATE
      SET name = EXCLUDED.name, status = 'active', updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `,
    [tenantSlug, tenantName, ownerUserId],
  );
  const organizationId = organization.rows[0]?.id;
  if (!organizationId) throw new Error("Enterprise organization bootstrap returned no organization id.");

  const tenant = await client.query<{ id: string }>(
    `
      INSERT INTO commerce_tenant (organization_id, slug, name, status, created_by_user_id)
      VALUES ($1, $2, $3, 'active', $4)
      ON CONFLICT (lower(slug)) DO UPDATE
      SET organization_id = EXCLUDED.organization_id, name = EXCLUDED.name,
          status = 'active', updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `,
    [organizationId, tenantSlug, tenantName, ownerUserId],
  );
  const tenantId = tenant.rows[0]?.id;
  if (!tenantId) throw new Error("Enterprise tenant bootstrap returned no tenant id.");

  await client.query(
    `
      INSERT INTO commerce_tenant_membership
        (tenant_id, user_id, status, seat_type, is_default, joined_at)
      VALUES ($1, $2, 'active', 'enterprise', true, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET status = 'active', seat_type = 'enterprise', is_default = true,
          joined_at = COALESCE(commerce_tenant_membership.joined_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
    `,
    [tenantId, ownerUserId],
  );
  await client.query(
    `UPDATE commerce_workspace SET is_default = false WHERE tenant_id = $1 AND is_default`,
    [tenantId],
  );

  const workspace = await client.query<{ id: string }>(
    `
      INSERT INTO commerce_workspace (tenant_id, slug, name, status, is_default, created_by_user_id)
      VALUES ($1, $2, $3, 'active', true, $4)
      ON CONFLICT (tenant_id, lower(slug)) DO UPDATE
      SET name = EXCLUDED.name, status = 'active', is_default = true, updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `,
    [tenantId, workspaceSlug, workspaceName, ownerUserId],
  );
  const workspaceId = workspace.rows[0]?.id;
  if (!workspaceId) throw new Error("Enterprise workspace bootstrap returned no workspace id.");

  await client.query(
    `UPDATE commerce_workspace_membership
     SET is_default = false, updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $1 AND user_id = $2 AND is_default`,
    [tenantId, ownerUserId],
  );
  await client.query(
    `
      INSERT INTO commerce_workspace_membership
        (tenant_id, workspace_id, user_id, status, is_default)
      VALUES ($1, $2, $3, 'active', true)
      ON CONFLICT (tenant_id, workspace_id, user_id) DO UPDATE
      SET status = 'active', is_default = true, updated_at = CURRENT_TIMESTAMP
    `,
    [tenantId, workspaceId, ownerUserId],
  );

  await client.query(
    `
      INSERT INTO commerce_enterprise_contract (
        tenant_id, status, seat_limit, workspace_limit,
        monthly_total_token_limit, monthly_model_request_limit,
        concurrent_turn_limit, concurrent_turn_limit_per_workspace,
        concurrent_turn_limit_per_user, token_reservation_per_turn,
        max_agent_threads_per_session
      ) VALUES ($1, 'active', $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id) DO UPDATE
      SET status = 'active', seat_limit = EXCLUDED.seat_limit,
          workspace_limit = EXCLUDED.workspace_limit,
          monthly_total_token_limit = EXCLUDED.monthly_total_token_limit,
          monthly_model_request_limit = EXCLUDED.monthly_model_request_limit,
          concurrent_turn_limit = EXCLUDED.concurrent_turn_limit,
          concurrent_turn_limit_per_workspace = EXCLUDED.concurrent_turn_limit_per_workspace,
          concurrent_turn_limit_per_user = EXCLUDED.concurrent_turn_limit_per_user,
          token_reservation_per_turn = EXCLUDED.token_reservation_per_turn,
          max_agent_threads_per_session = EXCLUDED.max_agent_threads_per_session,
          version = commerce_enterprise_contract.version + 1,
          updated_at = CURRENT_TIMESTAMP
    `,
    [
      tenantId,
      seatLimit,
      workspaceLimit,
      monthlyTokenLimit,
      monthlyModelRequestLimit,
      concurrentTurnLimit,
      perWorkspaceLimit,
      perUserLimit,
      tokenReservationPerTurn,
      maxAgentThreadsPerSession,
    ],
  );
  await client.query(
    `
      INSERT INTO commerce_tenant_runtime (tenant_id, isolation_mode, runtime_key, status)
      VALUES ($1, 'dedicated', $2, 'provisioning')
      ON CONFLICT (tenant_id) DO UPDATE
      SET isolation_mode = 'dedicated', runtime_key = EXCLUDED.runtime_key,
          updated_at = CURRENT_TIMESTAMP
    `,
    [tenantId, tenantSlug],
  );

  const roleIds = new Map<string, string>();
  for (const role of SYSTEM_ENTERPRISE_ROLES) {
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO commerce_enterprise_role
          (tenant_id, scope, role_key, name, description, allowed_permissions, is_system)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (tenant_id, scope, role_key) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description,
            allowed_permissions = EXCLUDED.allowed_permissions,
            denied_permissions = '{}', is_system = true, updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `,
      [tenantId, role.scope, role.key, role.name, role.description, role.allowedPermissions],
    );
    roleIds.set(role.key, inserted.rows[0]?.id as string);
  }

  for (const [roleKey, roleId] of [
    ["tenant_owner", roleIds.get("tenant_owner")],
    ["workspace_owner", roleIds.get("workspace_owner")],
  ] as const) {
    if (!roleId) throw new Error(`Missing seeded role ${roleKey}.`);
    await client.query(
      `
        INSERT INTO commerce_user_role_assignment
          (tenant_id, user_id, role_id, workspace_id, assigned_by_user_id)
        VALUES ($1, $2, $3, $4, $2)
        ON CONFLICT DO NOTHING
      `,
      [tenantId, ownerUserId, roleId, roleKey === "workspace_owner" ? workspaceId : null],
    );
  }

  await client.query("SELECT set_config('commerce.tenant_id', $1, true)", [tenantId]);
  await client.query("SELECT set_config('commerce.workspace_id', $1, true)", [workspaceId]);
  await client.query("SELECT set_config('commerce.user_id', $1, true)", [ownerUserId]);
  await client.query(
    `
      UPDATE commerce_agent_thread
      SET tenant_id = $1, workspace_id = $2, created_by_user_id = user_id
      WHERE user_id = $3 AND tenant_id IS NULL
    `,
    [tenantId, workspaceId, ownerUserId],
  );
  await client.query(
    `
      INSERT INTO commerce_enterprise_audit_event
        (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
      VALUES ($1, $2, $3, 'enterprise.bootstrap', 'tenant', $4, 'succeeded',
              jsonb_build_object(
                'edition', 'enterprise',
                'identityProof', CASE WHEN $5::boolean THEN 'operator_verified' ELSE 'local_development' END
              ))
    `,
    [tenantId, workspaceId, ownerUserId, tenantId, identityVerified],
  );

  await client.query("COMMIT");
  console.log(JSON.stringify({ ok: true, organizationId, tenantId, tenantSlug, workspaceId, workspaceSlug }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await database.end();
}

function readOptions(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--([a-z-]+)=(.+)$/);
    if (match) options[match[1] as string] = match[2] as string;
  }
  return options;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function boundedInteger(value: string, label: string, minimum: number, maximum: number): number {
  const parsed = positiveInteger(value, label);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
