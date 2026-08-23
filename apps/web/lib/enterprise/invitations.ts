import { createHash, randomBytes } from "node:crypto";

import { getAuthDatabase } from "@/lib/auth/database";
import { withEnterpriseTenantDatabaseContext } from "@/lib/enterprise/database-context";
import {
  mayAssignInvitationRoles,
  type AssignableInvitationRole,
} from "@/lib/enterprise/invitation-authorization";
import type { EnterpriseContext } from "@/lib/enterprise/types";

export type EnterpriseInvitationSummary = {
  id: string;
  email: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  roleKeys: string[];
  expiresAt: string;
  createdAt: string;
};

export async function listEnterpriseInvitations(
  context: EnterpriseContext,
): Promise<EnterpriseInvitationSummary[]> {
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query(
      `UPDATE commerce_enterprise_invitation SET status = 'expired'
       WHERE tenant_id = $1 AND status = 'pending' AND expires_at <= CURRENT_TIMESTAMP`,
      [context.tenantId],
    );
    const result = await client.query<{
      id: string;
      normalized_email: string;
      status: EnterpriseInvitationSummary["status"];
      role_keys: string[];
      expires_at: Date;
      created_at: Date;
    }>(
      `SELECT id, normalized_email, status, role_keys, expires_at, created_at
       FROM commerce_enterprise_invitation
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [context.tenantId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      email: row.normalized_email,
      status: row.status,
      roleKeys: row.role_keys,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    }));
  });
}

export async function revokeEnterpriseInvitation(
  context: EnterpriseContext,
  invitationId: string,
): Promise<void> {
  await withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-seat:${context.tenantId}`]);
    const result = await client.query(
      `UPDATE commerce_enterprise_invitation SET status = 'revoked'
       WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
      [context.tenantId, invitationId],
    );
    if (result.rowCount !== 1) {
      throw new EnterpriseInvitationError("待处理邀请不存在。", "INVITATION_NOT_PENDING", 404);
    }
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event
          (tenant_id, actor_user_id, action, target_type, target_id, outcome, metadata)
        VALUES ($1, $2, 'membership.invite.revoke', 'invitation', $3, 'succeeded', '{}'::jsonb)
      `,
      [context.tenantId, context.userId, invitationId],
    );
  });
}

export async function createEnterpriseInvitation(
  context: EnterpriseContext,
  input: { email: string; roleKeys: string[]; expiresInDays: number },
): Promise<{ id: string; token: string; expiresAt: string }> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-seat:${context.tenantId}`]);
    const existingMember = await client.query(
      `
        SELECT 1
        FROM commerce_tenant_membership membership
        INNER JOIN "user" account ON account.id = membership.user_id
        WHERE membership.tenant_id = $1
          AND membership.status IN ('active', 'invited')
          AND lower(account.email) = $2
        LIMIT 1
      `,
      [context.tenantId, normalizedEmail],
    );
    if (existingMember.rowCount === 1) {
      throw new EnterpriseInvitationError(
        "该邮箱已经是企业成员，请通过成员管理调整其角色。",
        "ALREADY_ENTERPRISE_MEMBER",
        409,
      );
    }
    const seats = await client.query<{ used: string }>(
      `
        SELECT (
          (SELECT count(*) FROM commerce_tenant_membership
           WHERE tenant_id = $1 AND status IN ('active', 'invited', 'suspended'))
          +
          (SELECT count(*) FROM commerce_enterprise_invitation
           WHERE tenant_id = $1 AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP
             AND lower(normalized_email) <> $2)
        )::text AS used
      `,
      [context.tenantId, normalizedEmail],
    );
    if (Number.parseInt(seats.rows[0]?.used || "0", 10) >= context.contract.seatLimit) {
      throw new EnterpriseInvitationError("企业席位已达到合同上限。", "ENTERPRISE_SEAT_LIMIT", 409);
    }
    const roles = await client.query<AssignableInvitationRole>(
      `
        SELECT role_key, allowed_permissions, denied_permissions, is_system
        FROM commerce_enterprise_role
        WHERE tenant_id = $1 AND role_key = ANY($2::text[])
      `,
      [context.tenantId, input.roleKeys],
    );
    const validRoleKeys = new Set(roles.rows.map((role) => role.role_key));
    if (input.roleKeys.some((key) => !validRoleKeys.has(key))) {
      throw new EnterpriseInvitationError("邀请包含无效角色。", "INVALID_ENTERPRISE_ROLE", 400);
    }
    if (!mayAssignInvitationRoles(context.roleKeys, context.permissions, roles.rows)) {
      throw new EnterpriseInvitationError(
        "您不能授予高于自身管理边界的企业角色。",
        "ENTERPRISE_ROLE_ESCALATION_DENIED",
        403,
      );
    }
    await client.query(
      `
        UPDATE commerce_enterprise_invitation
        SET status = 'revoked'
        WHERE tenant_id = $1 AND lower(normalized_email) = $2 AND status = 'pending'
      `,
      [context.tenantId, normalizedEmail],
    );
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO commerce_enterprise_invitation
          (tenant_id, workspace_id, normalized_email, token_hash, role_keys,
           invited_by_user_id, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        context.tenantId,
        context.workspaceId,
        normalizedEmail,
        tokenHash,
        input.roleKeys,
        context.userId,
        expiresAt,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("Enterprise invitation returned no id.");
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event
          (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
        VALUES ($1, $2, $3, 'membership.invite', 'invitation', $4, 'succeeded',
                jsonb_build_object('roleCount', $5::integer))
      `,
      [context.tenantId, context.workspaceId, context.userId, id, input.roleKeys.length],
    );
    return { id, token, expiresAt: expiresAt.toISOString() };
  });
}

export async function acceptEnterpriseInvitation(
  userId: string,
  token: string,
): Promise<{ tenantId: string; workspaceId: string }> {
  const database = getAuthDatabase();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const tokenHash = hashInvitationToken(token);
    await client.query("SELECT set_config('commerce.user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('commerce.invitation_token_hash', $1, true)", [tokenHash.toString("hex")]);
    await client.query("SELECT set_config('commerce.tenant_wide', 'off', true)");
    const candidate = await client.query<{ tenant_id: string; workspace_id: string }>(
      `SELECT tenant_id, workspace_id FROM commerce_enterprise_invitation WHERE token_hash = $1 LIMIT 1`,
      [tokenHash],
    );
    const candidateTenantId = candidate.rows[0]?.tenant_id;
    if (!candidateTenantId) {
      throw new EnterpriseInvitationError("邀请不存在或已过期。", "INVITATION_INVALID", 404);
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-seat:${candidateTenantId}`]);
    await client.query("SELECT set_config('commerce.tenant_id', $1, true)", [candidateTenantId]);
    await client.query("SELECT set_config('commerce.workspace_id', $1, true)", [candidate.rows[0]?.workspace_id]);
    const invitation = await client.query<{
      id: string;
      tenant_id: string;
      workspace_id: string;
      normalized_email: string;
      role_keys: string[];
      invited_by_user_id: string;
    }>(
      `
        SELECT id, tenant_id, workspace_id, normalized_email, role_keys, invited_by_user_id
        FROM commerce_enterprise_invitation
        WHERE token_hash = $1 AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP
        FOR UPDATE
      `,
      [tokenHash],
    );
    const row = invitation.rows[0];
    if (!row) throw new EnterpriseInvitationError("邀请不存在或已过期。", "INVITATION_INVALID", 404);
    const user = await client.query<{ email: string }>(
      `SELECT email FROM "user" WHERE id = $1 LIMIT 1`,
      [userId],
    );
    if (user.rows[0]?.email.toLowerCase() !== row.normalized_email) {
      throw new EnterpriseInvitationError("登录邮箱与邀请邮箱不匹配。", "INVITATION_EMAIL_MISMATCH", 403);
    }
    // The 256-bit, single-use invitation token is the verification challenge
    // for the invited work email. No OAuth account-linking providers are enabled.
    await client.query(
      `UPDATE "user" SET "emailVerified" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
      [userId],
    );
    const target = await client.query<{ tenant_status: string; workspace_status: string }>(
      `
        SELECT tenant.status AS tenant_status, workspace.status AS workspace_status
        FROM commerce_tenant tenant
        INNER JOIN commerce_workspace workspace
          ON workspace.tenant_id = tenant.id AND workspace.id = $2
        WHERE tenant.id = $1
        LIMIT 1
      `,
      [row.tenant_id, row.workspace_id],
    );
    if (target.rows[0]?.tenant_status !== "active" || target.rows[0]?.workspace_status !== "active") {
      throw new EnterpriseInvitationError("企业或工作区当前不可用。", "INVITATION_SCOPE_INACTIVE", 409);
    }
    const inviterRoles = await readInvitationManagerRoles(
      client,
      row.tenant_id,
      row.workspace_id,
      row.invited_by_user_id,
    );
    if (!inviterRoles.permissions.has("members.manage")) {
      throw new EnterpriseInvitationError("邀请发起人已失去成员管理权限。", "INVITATION_AUTHORITY_REVOKED", 403);
    }
    const invitedRoles = await client.query<AssignableInvitationRole>(
      `SELECT role_key, allowed_permissions, denied_permissions, is_system
       FROM commerce_enterprise_role
       WHERE tenant_id = $1 AND role_key = ANY($2::text[])`,
      [row.tenant_id, row.role_keys],
    );
    if (
      invitedRoles.rowCount !== row.role_keys.length ||
      !mayAssignInvitationRoles(inviterRoles.roleKeys, inviterRoles.permissions, invitedRoles.rows)
    ) {
      throw new EnterpriseInvitationError("邀请角色授权已失效。", "INVITATION_AUTHORITY_REVOKED", 403);
    }
    const contract = await client.query<{
      seat_limit: number;
      status: string;
      effective_from: Date;
      effective_until: Date | null;
    }>(
      `SELECT seat_limit, status, effective_from, effective_until
       FROM commerce_enterprise_contract WHERE tenant_id = $1`,
      [row.tenant_id],
    );
    const activeContract = contract.rows[0];
    const now = Date.now();
    if (
      activeContract?.status !== "active" ||
      activeContract.effective_from.getTime() > now ||
      (activeContract.effective_until !== null && activeContract.effective_until.getTime() <= now)
    ) {
      throw new EnterpriseInvitationError("企业合同当前不可用。", "ENTERPRISE_CONTRACT_INACTIVE", 409);
    }
    const seats = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM commerce_tenant_membership
       WHERE tenant_id = $1 AND status IN ('active', 'invited', 'suspended')`,
      [row.tenant_id],
    );
    if (Number.parseInt(seats.rows[0]?.count || "0", 10) >= (activeContract.seat_limit ?? 0)) {
      throw new EnterpriseInvitationError("企业席位已达到合同上限。", "ENTERPRISE_SEAT_LIMIT", 409);
    }
    const hasDefaultTenant = await client.query(
      `SELECT 1 FROM commerce_tenant_membership WHERE user_id = $1 AND status = 'active' AND is_default LIMIT 1`,
      [userId],
    );
    await client.query(
      `
        INSERT INTO commerce_tenant_membership
          (tenant_id, user_id, status, seat_type, is_default, invited_by_user_id, joined_at)
        SELECT tenant_id, $2, 'active', 'enterprise', $3, invited_by_user_id, CURRENT_TIMESTAMP
        FROM commerce_enterprise_invitation WHERE id = $1
        ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET status = 'active', joined_at = COALESCE(commerce_tenant_membership.joined_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      `,
      [row.id, userId, hasDefaultTenant.rowCount === 0],
    );
    await client.query(
      `
        INSERT INTO commerce_workspace_membership
          (tenant_id, workspace_id, user_id, status, is_default)
        VALUES ($1, $2, $3, 'active', true)
        ON CONFLICT (tenant_id, workspace_id, user_id) DO UPDATE
        SET status = 'active', updated_at = CURRENT_TIMESTAMP
      `,
      [row.tenant_id, row.workspace_id, userId],
    );
    await client.query(
      `
        INSERT INTO commerce_user_role_assignment
          (tenant_id, user_id, role_id, workspace_id, assigned_by_user_id)
        SELECT role.tenant_id, $2, role.id,
               CASE WHEN role.scope = 'workspace' THEN $3::uuid ELSE NULL END,
               invitation.invited_by_user_id
        FROM commerce_enterprise_role role
        CROSS JOIN commerce_enterprise_invitation invitation
        WHERE invitation.id = $1 AND role.tenant_id = invitation.tenant_id
          AND role.role_key = ANY(invitation.role_keys)
        ON CONFLICT DO NOTHING
      `,
      [row.id, userId, row.workspace_id],
    );
    await client.query(
      `UPDATE commerce_enterprise_invitation
       SET status = 'accepted', accepted_by_user_id = $2, accepted_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id, userId],
    );
    await client.query("SELECT set_config('commerce.tenant_id', $1, true)", [row.tenant_id]);
    await client.query("SELECT set_config('commerce.workspace_id', $1, true)", [row.workspace_id]);
    await client.query("SELECT set_config('commerce.user_id', $1, true)", [userId]);
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event
          (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
        VALUES ($1, $2, $3, 'membership.invite.accept', 'invitation', $4, 'succeeded',
                jsonb_build_object('identityProof', 'one_time_invitation_token'))
      `,
      [row.tenant_id, row.workspace_id, userId, row.id],
    );
    await client.query("COMMIT");
    return { tenantId: row.tenant_id, workspaceId: row.workspace_id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function validateEnterpriseInvitationRegistration(email: string, token: string): Promise<boolean> {
  const database = getAuthDatabase();
  const client = await database.connect();
  const tokenHash = hashInvitationToken(token);
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('commerce.invitation_token_hash', $1, true)", [tokenHash.toString("hex")]);
    const invitation = await client.query(
      `
        SELECT 1 FROM commerce_enterprise_invitation
        WHERE token_hash = $1 AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP
          AND lower(normalized_email) = lower($2)
        LIMIT 1
      `,
      [tokenHash, email],
    );
    await client.query("COMMIT");
    return invitation.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class EnterpriseInvitationError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "EnterpriseInvitationError";
  }
}

function hashInvitationToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

async function readInvitationManagerRoles(
  client: import("pg").PoolClient,
  tenantId: string,
  workspaceId: string,
  userId: string,
): Promise<{ roleKeys: string[]; permissions: Set<string> }> {
  const active = await client.query(
    `SELECT 1 FROM commerce_tenant_membership
     WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
    [tenantId, userId],
  );
  if (active.rowCount !== 1) return { roleKeys: [], permissions: new Set() };
  const roles = await client.query<{
    role_key: string;
    allowed_permissions: string[];
    denied_permissions: string[];
  }>(
    `
      WITH direct_roles AS (
        SELECT role.role_key, role.allowed_permissions, role.denied_permissions
        FROM commerce_user_role_assignment assignment
        INNER JOIN commerce_enterprise_role role
          ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
        WHERE assignment.tenant_id = $1 AND assignment.user_id = $3
          AND (assignment.workspace_id IS NULL OR assignment.workspace_id = $2)
      ), group_roles AS (
        SELECT role.role_key, role.allowed_permissions, role.denied_permissions
        FROM commerce_enterprise_group_member member
        INNER JOIN commerce_enterprise_group "group"
          ON "group".tenant_id = member.tenant_id AND "group".id = member.group_id
         AND "group".status = 'active'
        INNER JOIN commerce_group_role_assignment assignment
          ON assignment.tenant_id = member.tenant_id AND assignment.group_id = member.group_id
        INNER JOIN commerce_enterprise_role role
          ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
        WHERE member.tenant_id = $1 AND member.user_id = $3
          AND (assignment.workspace_id IS NULL OR assignment.workspace_id = $2)
      )
      SELECT * FROM direct_roles UNION ALL SELECT * FROM group_roles
    `,
    [tenantId, workspaceId, userId],
  );
  const denied = new Set(roles.rows.flatMap((role) => role.denied_permissions));
  const permissions = new Set(
    roles.rows.flatMap((role) => role.allowed_permissions).filter((permission) => !denied.has(permission)),
  );
  return { roleKeys: roles.rows.map((role) => role.role_key), permissions };
}
