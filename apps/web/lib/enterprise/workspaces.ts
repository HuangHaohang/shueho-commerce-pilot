import { withEnterpriseTenantDatabaseContext } from "@/lib/enterprise/database-context";
import {
  mayAssignInvitationRoles,
  type AssignableInvitationRole,
} from "@/lib/enterprise/invitation-authorization";
import type { EnterpriseContext } from "@/lib/enterprise/types";

export type EnterpriseWorkspaceSummary = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "archived";
  isDefault: boolean;
  memberCount: number;
  isMember: boolean;
};

export async function listEnterpriseWorkspaces(
  context: EnterpriseContext,
): Promise<EnterpriseWorkspaceSummary[]> {
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    const result = await client.query<{
      id: string;
      slug: string;
      name: string;
      status: EnterpriseWorkspaceSummary["status"];
      is_default: boolean;
      member_count: string;
      is_member: boolean;
    }>(
      `
        SELECT workspace.id, workspace.slug, workspace.name, workspace.status, workspace.is_default,
               count(member.user_id) FILTER (WHERE member.status = 'active')::text AS member_count
               ,COALESCE(bool_or(member.user_id = $2 AND member.status = 'active'), false) AS is_member
        FROM commerce_workspace workspace
        LEFT JOIN commerce_workspace_membership member
          ON member.tenant_id = workspace.tenant_id AND member.workspace_id = workspace.id
        WHERE workspace.tenant_id = $1
        GROUP BY workspace.id
        ORDER BY workspace.is_default DESC, workspace.created_at, workspace.name
      `,
      [context.tenantId, context.userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      isDefault: row.is_default,
      memberCount: Number.parseInt(row.member_count, 10),
      isMember: row.is_member,
    }));
  });
}

export async function createEnterpriseWorkspace(
  context: EnterpriseContext,
  input: { slug: string; name: string },
): Promise<{ id: string }> {
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-workspace:${context.tenantId}`]);
    const contract = await client.query<{ workspace_limit: number; status: string }>(
      `SELECT workspace_limit, status FROM commerce_enterprise_contract WHERE tenant_id = $1 LIMIT 1`,
      [context.tenantId],
    );
    if (contract.rows[0]?.status !== "active") {
      throw new EnterpriseWorkspaceError("企业合同当前不可用。", "ENTERPRISE_CONTRACT_INACTIVE", 409);
    }
    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM commerce_workspace WHERE tenant_id = $1 AND status = 'active'`,
      [context.tenantId],
    );
    if (Number.parseInt(count.rows[0]?.count || "0", 10) >= contract.rows[0].workspace_limit) {
      throw new EnterpriseWorkspaceError("工作区数量已达到合同上限。", "ENTERPRISE_WORKSPACE_LIMIT", 409);
    }
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO commerce_workspace (tenant_id, slug, name, status, is_default, created_by_user_id)
        VALUES ($1, $2, $3, 'active', false, $4)
        RETURNING id
      `,
      [context.tenantId, input.slug, input.name, context.userId],
    );
    const workspaceId = inserted.rows[0]?.id;
    if (!workspaceId) throw new Error("Workspace insert returned no id.");
    await client.query(
      `
        INSERT INTO commerce_workspace_membership (tenant_id, workspace_id, user_id, status, is_default)
        VALUES ($1, $2, $3, 'active', false)
      `,
      [context.tenantId, workspaceId, context.userId],
    );
    await client.query(
      `
        INSERT INTO commerce_user_role_assignment
          (tenant_id, user_id, role_id, workspace_id, assigned_by_user_id)
        SELECT $1, $2, role.id, $3, $2
        FROM commerce_enterprise_role role
        WHERE role.tenant_id = $1 AND role.role_key = 'workspace_owner' AND role.scope = 'workspace'
      `,
      [context.tenantId, context.userId, workspaceId],
    );
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event
          (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
        VALUES ($1, $2::uuid, $3, 'workspace.create', 'workspace', $2::uuid::text, 'succeeded', '{}'::jsonb)
      `,
      [context.tenantId, workspaceId, context.userId],
    );
    return { id: workspaceId };
  }).catch((error) => {
    if (isUniqueViolation(error)) {
      throw new EnterpriseWorkspaceError("工作区标识已存在。", "WORKSPACE_SLUG_EXISTS", 409);
    }
    throw error;
  });
}

export async function changeEnterpriseWorkspaceStatus(
  context: EnterpriseContext,
  workspaceId: string,
  nextStatus: "active" | "archived",
): Promise<void> {
  await withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-workspace:${context.tenantId}`]);
    const workspace = await client.query<{ status: string; is_default: boolean }>(
      `SELECT status, is_default FROM commerce_workspace
       WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [context.tenantId, workspaceId],
    );
    const current = workspace.rows[0];
    if (!current) throw new EnterpriseWorkspaceError("工作区不存在。", "WORKSPACE_NOT_FOUND", 404);
    if (current.is_default && nextStatus === "archived") {
      throw new EnterpriseWorkspaceError("默认工作区不能归档。", "DEFAULT_WORKSPACE_PROTECTED", 409);
    }
    if (nextStatus === "active" && current.status === "archived") {
      const contract = await client.query<{ workspace_limit: number }>(
        `SELECT workspace_limit FROM commerce_enterprise_contract WHERE tenant_id = $1 AND status = 'active'`,
        [context.tenantId],
      );
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM commerce_workspace WHERE tenant_id = $1 AND status = 'active'`,
        [context.tenantId],
      );
      if (Number.parseInt(count.rows[0]?.count || "0", 10) >= (contract.rows[0]?.workspace_limit ?? 0)) {
        throw new EnterpriseWorkspaceError("工作区数量已达到合同上限。", "ENTERPRISE_WORKSPACE_LIMIT", 409);
      }
    }
    if (nextStatus === "archived") {
      const running = await client.query(
        `SELECT 1 FROM commerce_agent_thread
         WHERE tenant_id = $1 AND workspace_id = $2 AND status = 'running' LIMIT 1`,
        [context.tenantId, workspaceId],
      );
      if (running.rowCount === 1) {
        throw new EnterpriseWorkspaceError("工作区仍有运行中任务。", "WORKSPACE_HAS_RUNNING_TURNS", 409);
      }
    }
    await client.query(
      `UPDATE commerce_workspace SET status = $3, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND id = $2`,
      [context.tenantId, workspaceId, nextStatus],
    );
    await client.query(
      `UPDATE commerce_workspace_membership
       SET status = CASE WHEN $3 = 'active' THEN 'active' ELSE 'suspended' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND workspace_id = $2 AND status <> 'removed'`,
      [context.tenantId, workspaceId, nextStatus],
    );
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event
          (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
        VALUES ($1, $2::uuid, $3, 'workspace.status.change', 'workspace', $2::uuid::text, 'succeeded',
                jsonb_build_object('to', $4::text))
      `,
      [context.tenantId, workspaceId, context.userId, nextStatus],
    );
  });
}

export async function upsertEnterpriseWorkspaceMember(
  context: EnterpriseContext,
  workspaceId: string,
  targetUserId: string,
  roleKeys: string[],
): Promise<void> {
  await withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `enterprise-workspace-member:${context.tenantId}:${workspaceId}:${targetUserId}`,
    ]);
    const target = await client.query(
      `
        SELECT 1 FROM commerce_tenant_membership member
        INNER JOIN commerce_workspace workspace ON workspace.tenant_id = member.tenant_id
        WHERE member.tenant_id = $1 AND member.user_id = $2 AND member.status = 'active'
          AND workspace.id = $3 AND workspace.status = 'active'
        LIMIT 1
      `,
      [context.tenantId, targetUserId, workspaceId],
    );
    if (target.rowCount !== 1) {
      throw new EnterpriseWorkspaceError("成员或工作区当前不可用。", "WORKSPACE_MEMBER_SCOPE_INVALID", 404);
    }
    const roles = await client.query<AssignableInvitationRole>(
      `SELECT role_key, allowed_permissions, denied_permissions, is_system
       FROM commerce_enterprise_role
       WHERE tenant_id = $1 AND scope = 'workspace' AND role_key = ANY($2::text[])`,
      [context.tenantId, roleKeys],
    );
    if (
      roles.rowCount !== roleKeys.length ||
      !mayAssignInvitationRoles(context.roleKeys, context.permissions, roles.rows)
    ) {
      throw new EnterpriseWorkspaceError("工作区角色授权无效。", "WORKSPACE_ROLE_ASSIGNMENT_DENIED", 403);
    }
    await client.query(
      `
        INSERT INTO commerce_workspace_membership (tenant_id, workspace_id, user_id, status, is_default)
        VALUES ($1, $2, $3, 'active', false)
        ON CONFLICT (tenant_id, workspace_id, user_id) DO UPDATE
        SET status = 'active', updated_at = CURRENT_TIMESTAMP
      `,
      [context.tenantId, workspaceId, targetUserId],
    );
    await client.query(
      `
        DELETE FROM commerce_user_role_assignment assignment
        USING commerce_enterprise_role role
        WHERE assignment.tenant_id = $1 AND assignment.workspace_id = $2
          AND assignment.user_id = $3 AND role.tenant_id = assignment.tenant_id
          AND role.id = assignment.role_id AND role.scope = 'workspace'
      `,
      [context.tenantId, workspaceId, targetUserId],
    );
    await client.query(
      `
        INSERT INTO commerce_user_role_assignment
          (tenant_id, user_id, role_id, workspace_id, assigned_by_user_id)
        SELECT role.tenant_id, $3, role.id, $2, $4
        FROM commerce_enterprise_role role
        WHERE role.tenant_id = $1 AND role.scope = 'workspace'
          AND role.role_key = ANY($5::text[])
      `,
      [context.tenantId, workspaceId, targetUserId, context.userId, roleKeys],
    );
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event
          (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
        VALUES ($1, $2, $3, 'workspace.member.roles.set', 'user', $4, 'succeeded',
                jsonb_build_object('roleCount', $5::integer))
      `,
      [context.tenantId, workspaceId, context.userId, targetUserId, roleKeys.length],
    );
  });
}

export async function removeEnterpriseWorkspaceMember(
  context: EnterpriseContext,
  workspaceId: string,
  targetUserId: string,
): Promise<void> {
  if (targetUserId === context.userId) {
    throw new EnterpriseWorkspaceError("不能在当前会话中移除自己的工作区访问。", "SELF_WORKSPACE_REMOVAL_DENIED", 409);
  }
  await withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `enterprise-workspace-member:${context.tenantId}:${workspaceId}:${targetUserId}`,
    ]);
    const workspace = await client.query<{ is_default: boolean }>(
      `SELECT is_default FROM commerce_workspace WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [context.tenantId, workspaceId],
    );
    if (!workspace.rows[0]) {
      throw new EnterpriseWorkspaceError("工作区不存在。", "WORKSPACE_NOT_FOUND", 404);
    }
    if (workspace.rows[0].is_default) {
      throw new EnterpriseWorkspaceError("默认工作区成员请通过企业成员停权流程处理。", "DEFAULT_WORKSPACE_MEMBER_PROTECTED", 409);
    }
    const updated = await client.query(
      `UPDATE commerce_workspace_membership
       SET status = 'removed', is_default = false, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3 AND status <> 'removed'`,
      [context.tenantId, workspaceId, targetUserId],
    );
    if (updated.rowCount !== 1) {
      throw new EnterpriseWorkspaceError("工作区成员不存在。", "WORKSPACE_MEMBER_NOT_FOUND", 404);
    }
    await client.query(
      `DELETE FROM commerce_user_role_assignment
       WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3`,
      [context.tenantId, workspaceId, targetUserId],
    );
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event
          (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
        VALUES ($1, $2, $3, 'workspace.member.remove', 'user', $4, 'succeeded', '{}'::jsonb)
      `,
      [context.tenantId, workspaceId, context.userId, targetUserId],
    );
  });
}

export class EnterpriseWorkspaceError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "EnterpriseWorkspaceError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
