import { NextResponse } from "next/server";

import { getAuthDatabase } from "@/lib/auth/database";
import { getAuthenticatedUserId } from "@/lib/auth/require-session";
import { ENTERPRISE_PERMISSIONS, type EnterprisePermission } from "@/lib/enterprise/permissions";
import type { EnterpriseContext } from "@/lib/enterprise/types";

type ContextRow = {
  organization_id: string;
  organization_slug: string;
  organization_name: string;
  organization_status: EnterpriseContext["organizationStatus"];
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  tenant_status: EnterpriseContext["tenantStatus"];
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  contract_status: EnterpriseContext["contract"]["status"];
  seat_limit: number;
  workspace_limit: number;
  monthly_total_token_limit: string | number | null;
  monthly_model_request_limit: string | number | null;
  concurrent_turn_limit: number;
  concurrent_turn_limit_per_workspace: number;
  concurrent_turn_limit_per_user: number;
  token_reservation_per_turn: string | number;
  max_agent_threads_per_session: number;
  billing_anchor_day: number;
  effective_from: Date;
  effective_until: Date | null;
};

type RoleRow = {
  role_key: string;
  scope: "tenant" | "workspace";
  allowed_permissions: string[];
  denied_permissions: string[];
};

type ContextCandidate = {
  tenant_id: string;
  workspace_id: string;
};

export type EnterpriseContextResult =
  | { ok: true; context: EnterpriseContext }
  | { ok: false; response: NextResponse };

export async function resolveEnterpriseContext(
  request: Request,
  options: { requireActiveContract?: boolean } = {},
): Promise<EnterpriseContextResult> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: "请先登录。" }, { status: 401 }) };
  }

  const requestedWorkspaceHeader = request.headers.get("x-commerce-workspace-id")?.trim() || null;
  const requestedWorkspaceCookie = readCookie(request, "commerce_workspace");
  const requestedWorkspaceId = requestedWorkspaceHeader || requestedWorkspaceCookie || null;
  if (requestedWorkspaceId && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestedWorkspaceId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "工作区标识无效。" }, { status: 400 }),
    };
  }
  let loaded = await loadEnterpriseContext(userId, requestedWorkspaceId);
  if (!loaded && !requestedWorkspaceHeader && requestedWorkspaceCookie) {
    loaded = await loadEnterpriseContext(userId, null);
  }
  const row = loaded?.row;
  const roles = loaded?.roles ?? [];
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "该账号尚未获得企业工作区访问权限。", code: "ENTERPRISE_ACCESS_REQUIRED" },
        { status: 403 },
      ),
    };
  }
  if (row.organization_status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "企业组织当前不可用。", code: "ORGANIZATION_NOT_ACTIVE" },
        { status: 423 },
      ),
    };
  }
  if (row.tenant_status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "企业租户当前不可用。", code: "TENANT_NOT_ACTIVE" },
        { status: 423 },
      ),
    };
  }
  if (options.requireActiveContract !== false && row.contract_status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "企业合同尚未激活或已暂停。", code: "ENTERPRISE_CONTRACT_INACTIVE" },
        { status: 402 },
      ),
    };
  }
  const now = Date.now();
  if (
    options.requireActiveContract !== false &&
    (row.effective_from.getTime() > now || (row.effective_until !== null && row.effective_until.getTime() <= now))
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "企业合同不在有效期内。", code: "ENTERPRISE_CONTRACT_OUTSIDE_TERM" },
        { status: 402 },
      ),
    };
  }

  const denied = new Set(roles.flatMap((role) => role.denied_permissions));
  const permissionCatalog = new Set<string>(ENTERPRISE_PERMISSIONS);
  const allowed = new Set<EnterprisePermission>();
  const tenantAllowed = new Set<EnterprisePermission>();
  for (const role of roles) {
    for (const permission of role.allowed_permissions) {
      if (permissionCatalog.has(permission) && !denied.has(permission)) {
        allowed.add(permission as EnterprisePermission);
        if (role.scope === "tenant") tenantAllowed.add(permission as EnterprisePermission);
      }
    }
  }

  return {
    ok: true,
    context: {
      userId,
      organizationId: row.organization_id,
      organizationSlug: row.organization_slug,
      organizationName: row.organization_name,
      organizationStatus: row.organization_status,
      tenantId: row.tenant_id,
      tenantSlug: row.tenant_slug,
      tenantName: row.tenant_name,
      tenantStatus: row.tenant_status,
      workspaceId: row.workspace_id,
      workspaceSlug: row.workspace_slug,
      workspaceName: row.workspace_name,
      roleKeys: roles.map((role) => role.role_key),
      permissions: allowed,
      tenantPermissions: tenantAllowed,
      contract: {
        status: row.contract_status,
        seatLimit: row.seat_limit,
        workspaceLimit: row.workspace_limit,
        monthlyTotalTokenLimit: nullableNumber(row.monthly_total_token_limit),
        monthlyModelRequestLimit: nullableNumber(row.monthly_model_request_limit),
        concurrentTurnLimit: row.concurrent_turn_limit,
        concurrentTurnLimitPerWorkspace: row.concurrent_turn_limit_per_workspace,
        concurrentTurnLimitPerUser: row.concurrent_turn_limit_per_user,
        tokenReservationPerTurn: nullableNumber(row.token_reservation_per_turn) ?? 50_000,
        maxAgentThreadsPerSession: row.max_agent_threads_per_session,
        billingAnchorDay: row.billing_anchor_day,
        effectiveFrom: row.effective_from.toISOString(),
        effectiveUntil: row.effective_until?.toISOString() ?? null,
      },
    },
  };
}

async function loadEnterpriseContext(
  userId: string,
  requestedWorkspaceId: string | null,
): Promise<{ row: ContextRow; roles: RoleRow[] } | null> {
  const client = await getAuthDatabase().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SELECT set_config('commerce.user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('commerce.tenant_wide', 'off', true)");
    const candidates = await client.query<ContextCandidate>(
      `
        SELECT tenant_member.tenant_id, workspace_member.workspace_id
        FROM commerce_tenant_membership tenant_member
        INNER JOIN commerce_workspace_membership workspace_member
          ON workspace_member.tenant_id = tenant_member.tenant_id
         AND workspace_member.user_id = tenant_member.user_id
        WHERE tenant_member.user_id = $1
          AND tenant_member.status = 'active'
          AND workspace_member.status = 'active'
          AND ($2::uuid IS NULL OR workspace_member.workspace_id = $2::uuid)
        ORDER BY tenant_member.is_default DESC, workspace_member.is_default DESC,
                 tenant_member.created_at, workspace_member.created_at
        LIMIT 1
      `,
      [userId, requestedWorkspaceId],
    );
    const candidate = candidates.rows[0];
    if (!candidate) {
      await client.query("COMMIT");
      return null;
    }
    await client.query("SELECT set_config('commerce.tenant_id', $1, true)", [candidate.tenant_id]);
    await client.query("SELECT set_config('commerce.workspace_id', $1, true)", [candidate.workspace_id]);
    const tenantIdentity = await client.query<{ organization_id: string }>(
      `SELECT organization_id FROM commerce_tenant WHERE id = $1 LIMIT 1`,
      [candidate.tenant_id],
    );
    const organizationId = tenantIdentity.rows[0]?.organization_id;
    if (!organizationId) {
      await client.query("COMMIT");
      return null;
    }
    await client.query("SELECT set_config('commerce.organization_id', $1, true)", [organizationId]);
    const result = await client.query<ContextRow>(
    `
      SELECT
        organization.id AS organization_id,
        organization.slug AS organization_slug,
        organization.name AS organization_name,
        organization.status AS organization_status,
        tenant.id AS tenant_id,
        tenant.slug AS tenant_slug,
        tenant.name AS tenant_name,
        tenant.status AS tenant_status,
        workspace.id AS workspace_id,
        workspace.slug AS workspace_slug,
        workspace.name AS workspace_name,
        contract.status AS contract_status,
        contract.seat_limit,
        contract.workspace_limit,
        contract.monthly_total_token_limit,
        contract.monthly_model_request_limit,
        contract.concurrent_turn_limit,
        contract.concurrent_turn_limit_per_workspace,
        contract.concurrent_turn_limit_per_user,
        contract.token_reservation_per_turn,
        contract.max_agent_threads_per_session,
        contract.billing_anchor_day,
        contract.effective_from,
        contract.effective_until
      FROM commerce_tenant_membership tenant_member
      INNER JOIN commerce_tenant tenant ON tenant.id = tenant_member.tenant_id
      INNER JOIN commerce_organization organization ON organization.id = tenant.organization_id
      INNER JOIN commerce_workspace_membership workspace_member
        ON workspace_member.tenant_id = tenant_member.tenant_id
       AND workspace_member.user_id = tenant_member.user_id
       AND workspace_member.status = 'active'
      INNER JOIN commerce_workspace workspace
        ON workspace.tenant_id = workspace_member.tenant_id
       AND workspace.id = workspace_member.workspace_id
       AND workspace.status = 'active'
      INNER JOIN commerce_enterprise_contract contract ON contract.tenant_id = tenant.id
      WHERE tenant_member.user_id = $1
        AND tenant_member.tenant_id = $3
        AND tenant_member.status = 'active'
        AND workspace.id = $2::uuid
      LIMIT 1
    `,
      [userId, candidate.workspace_id, candidate.tenant_id],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    const roles = await readEffectiveRoles(client, row.tenant_id, row.workspace_id, userId);
    await client.query("COMMIT");
    return { row, roles };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function requireEnterprisePermission(
  context: EnterpriseContext,
  permission: EnterprisePermission,
): NextResponse | null {
  if (!context.permissions.has(permission)) {
    return NextResponse.json(
      { error: "您没有执行该操作的工作区权限。", code: "ENTERPRISE_PERMISSION_DENIED" },
      { status: 403 },
    );
  }
  return null;
}

export function requireEnterpriseTenantPermission(
  context: EnterpriseContext,
  permission: EnterprisePermission,
): NextResponse | null {
  if (!context.tenantPermissions.has(permission)) {
    return NextResponse.json(
      { error: "您没有执行该租户级操作的权限。", code: "ENTERPRISE_TENANT_PERMISSION_DENIED" },
      { status: 403 },
    );
  }
  return null;
}

async function readEffectiveRoles(
  client: import("pg").PoolClient,
  tenantId: string,
  workspaceId: string,
  userId: string,
): Promise<RoleRow[]> {
  const result = await client.query<RoleRow>(
    `
      WITH direct_roles AS (
        SELECT role.role_key, role.scope, role.allowed_permissions, role.denied_permissions
        FROM commerce_user_role_assignment assignment
        INNER JOIN commerce_enterprise_role role
          ON role.tenant_id = assignment.tenant_id
         AND role.id = assignment.role_id
        WHERE assignment.tenant_id = $1
          AND assignment.user_id = $3
          AND (assignment.workspace_id IS NULL OR assignment.workspace_id = $2)
      ), group_roles AS (
        SELECT role.role_key, role.scope, role.allowed_permissions, role.denied_permissions
        FROM commerce_enterprise_group_member member
        INNER JOIN commerce_enterprise_group "group"
          ON "group".tenant_id = member.tenant_id
         AND "group".id = member.group_id
         AND "group".status = 'active'
        INNER JOIN commerce_group_role_assignment assignment
          ON assignment.tenant_id = member.tenant_id
         AND assignment.group_id = member.group_id
        INNER JOIN commerce_enterprise_role role
          ON role.tenant_id = assignment.tenant_id
         AND role.id = assignment.role_id
        WHERE member.tenant_id = $1
          AND member.user_id = $3
          AND (assignment.workspace_id IS NULL OR assignment.workspace_id = $2)
      )
      SELECT * FROM direct_roles
      UNION ALL
      SELECT * FROM group_roles
    `,
    [tenantId, workspaceId, userId],
  );
  return result.rows;
}

function nullableNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}
