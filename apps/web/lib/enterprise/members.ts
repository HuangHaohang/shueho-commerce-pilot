import { withEnterpriseTenantDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseContext } from "@/lib/enterprise/types";

export type EnterpriseMember = {
  userId: string;
  name: string;
  email: string;
  status: "invited" | "active" | "suspended" | "removed";
  joinedAt: string | null;
  roleKeys: string[];
  workspaces: Array<{ id: string; name: string; status: string }>;
};

export type RevokedThread = {
  threadId: string;
  turnId: string;
  workspaceId: string;
  userId: string;
};

export async function listEnterpriseMembers(context: EnterpriseContext): Promise<EnterpriseMember[]> {
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    const result = await client.query<{
      user_id: string;
      name: string;
      email: string;
      status: EnterpriseMember["status"];
      joined_at: Date | null;
      role_keys: string[];
      workspaces: EnterpriseMember["workspaces"];
    }>(
      `
        SELECT membership.user_id, account.name, account.email, membership.status, membership.joined_at,
          COALESCE((
            SELECT array_agg(DISTINCT role.role_key ORDER BY role.role_key)
            FROM commerce_user_role_assignment assignment
            INNER JOIN commerce_enterprise_role role
              ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
            WHERE assignment.tenant_id = membership.tenant_id AND assignment.user_id = membership.user_id
          ), '{}'::text[]) AS role_keys,
          COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object('id', workspace.id, 'name', workspace.name, 'status', workspace_member.status)
              ORDER BY workspace.name
            )
            FROM commerce_workspace_membership workspace_member
            INNER JOIN commerce_workspace workspace
              ON workspace.tenant_id = workspace_member.tenant_id AND workspace.id = workspace_member.workspace_id
            WHERE workspace_member.tenant_id = membership.tenant_id
              AND workspace_member.user_id = membership.user_id
              AND workspace_member.status <> 'removed'
          ), '[]'::jsonb) AS workspaces
        FROM commerce_tenant_membership membership
        INNER JOIN "user" account ON account.id = membership.user_id
        WHERE membership.tenant_id = $1 AND membership.status <> 'removed'
        ORDER BY (membership.status = 'active') DESC, account.name, account.email
        LIMIT 500
      `,
      [context.tenantId],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      status: row.status,
      joinedAt: row.joined_at?.toISOString() ?? null,
      roleKeys: row.role_keys,
      workspaces: row.workspaces,
    }));
  });
}

export async function changeEnterpriseMemberStatus(
  context: EnterpriseContext,
  targetUserId: string,
  nextStatus: "active" | "suspended" | "removed",
): Promise<{ previousStatus: string; threads: RevokedThread[] }> {
  if (targetUserId === context.userId) {
    throw new EnterpriseMemberError("不能在当前会话中停用或移除自己。", "SELF_MEMBERSHIP_CHANGE_DENIED", 409);
  }
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-member:${context.tenantId}:${targetUserId}`]);
    const membership = await client.query<{ status: string }>(
      `SELECT status FROM commerce_tenant_membership
       WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`,
      [context.tenantId, targetUserId],
    );
    const previousStatus = membership.rows[0]?.status;
    if (!previousStatus || previousStatus === "removed") {
      throw new EnterpriseMemberError("企业成员不存在。", "ENTERPRISE_MEMBER_NOT_FOUND", 404);
    }
    if (nextStatus === "active" && previousStatus !== "suspended") {
      throw new EnterpriseMemberError("只有已暂停成员可以重新启用。", "INVALID_MEMBERSHIP_TRANSITION", 409);
    }
    const ownerRole = await client.query(
      `
        SELECT 1
        FROM commerce_user_role_assignment assignment
        INNER JOIN commerce_enterprise_role role
          ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
        WHERE assignment.tenant_id = $1 AND assignment.user_id = $2
          AND assignment.workspace_id IS NULL AND role.role_key = 'tenant_owner'
        LIMIT 1
      `,
      [context.tenantId, targetUserId],
    );
    if (ownerRole.rowCount === 1) {
      throw new EnterpriseMemberError(
        "企业所有者必须先通过受控所有权转移流程处理。",
        "TENANT_OWNER_PROTECTED",
        409,
      );
    }
    const running = await client.query<{
      thread_id: string;
      active_turn_id: string;
      workspace_id: string;
      created_by_user_id: string;
    }>(
      `
        SELECT thread_id, active_turn_id, workspace_id, created_by_user_id
        FROM commerce_agent_thread
        WHERE tenant_id = $1 AND created_by_user_id = $2
          AND status = 'running' AND active_turn_id IS NOT NULL
      `,
      [context.tenantId, targetUserId],
    );
    await client.query(
      `UPDATE commerce_tenant_membership
       SET status = $3, is_default = CASE WHEN $3 = 'active' THEN is_default ELSE false END,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND user_id = $2`,
      [context.tenantId, targetUserId, nextStatus],
    );
    const workspaceTransition =
      nextStatus === "active"
        ? { from: "suspended", to: "active" }
        : nextStatus === "suspended"
          ? { from: "active", to: "suspended" }
          : { from: null, to: "removed" };
    await client.query(
      `UPDATE commerce_workspace_membership
       SET status = $3, is_default = CASE WHEN $3 = 'active' THEN is_default ELSE false END,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND user_id = $2
         AND ($4::text IS NULL OR status = $4::text)
         AND status <> 'removed'`,
      [context.tenantId, targetUserId, workspaceTransition.to, workspaceTransition.from],
    );
    if (nextStatus === "removed") {
      await client.query(
        `DELETE FROM commerce_user_role_assignment WHERE tenant_id = $1 AND user_id = $2`,
        [context.tenantId, targetUserId],
      );
      await client.query(
        `DELETE FROM commerce_enterprise_group_member WHERE tenant_id = $1 AND user_id = $2`,
        [context.tenantId, targetUserId],
      );
    }
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event
          (tenant_id, actor_user_id, action, target_type, target_id, outcome, metadata)
        VALUES ($1, $2, 'membership.status.change', 'user', $3, 'succeeded',
                jsonb_build_object('from', $4::text, 'to', $5::text))
      `,
      [context.tenantId, context.userId, targetUserId, previousStatus, nextStatus],
    );
    return {
      previousStatus,
      threads: running.rows.map((row) => ({
        threadId: row.thread_id,
        turnId: row.active_turn_id,
        workspaceId: row.workspace_id,
        userId: row.created_by_user_id,
      })),
    };
  });
}

export class EnterpriseMemberError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "EnterpriseMemberError";
  }
}
