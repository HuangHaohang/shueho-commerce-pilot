import { billingPeriodStart } from "@/lib/enterprise/billing-period";
import { withEnterpriseTenantDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";

export type RuntimeAuthorizationScope = EnterpriseScope & {
  rootThreadId: string;
  runtimeMaxAgentThreads?: number;
};

export async function authorizeRuntimeScope(scope: RuntimeAuthorizationScope): Promise<boolean> {
  return withEnterpriseTenantDatabaseContext(scope, async (client) => {
    const tenant = await client.query<{ organization_id: string }>(
      `SELECT organization_id FROM commerce_tenant WHERE id = $1 AND status = 'active' LIMIT 1`,
      [scope.tenantId],
    );
    const organizationId = tenant.rows[0]?.organization_id;
    if (!organizationId) return false;
    await client.query("SELECT set_config('commerce.organization_id', $1, true)", [organizationId]);
    const result = await client.query<{
      billing_anchor_day: number;
      monthly_total_token_limit: string | null;
      monthly_model_request_limit: string | null;
      max_agent_threads_per_session: number;
    }>(
      `
        WITH effective_roles AS (
          SELECT role.allowed_permissions, role.denied_permissions
          FROM commerce_user_role_assignment assignment
          INNER JOIN commerce_enterprise_role role
            ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
          WHERE assignment.tenant_id = $1 AND assignment.user_id = $3
            AND (assignment.workspace_id IS NULL OR assignment.workspace_id = $2)
          UNION ALL
          SELECT role.allowed_permissions, role.denied_permissions
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
        ), permission_state AS (
          SELECT
            COALESCE(bool_or('agent.run' = ANY(allowed_permissions)), false) AS allowed,
            COALESCE(bool_or('agent.run' = ANY(denied_permissions)), false) AS denied
          FROM effective_roles
        )
        SELECT contract.billing_anchor_day,
               contract.monthly_total_token_limit::text,
               contract.monthly_model_request_limit::text,
               contract.max_agent_threads_per_session
        FROM commerce_organization organization
        INNER JOIN commerce_tenant tenant
          ON tenant.organization_id = organization.id AND tenant.id = $1 AND tenant.status = 'active'
        INNER JOIN commerce_workspace workspace
          ON workspace.tenant_id = tenant.id AND workspace.id = $2 AND workspace.status = 'active'
        INNER JOIN commerce_tenant_membership tenant_member
          ON tenant_member.tenant_id = tenant.id AND tenant_member.user_id = $3
         AND tenant_member.status = 'active'
        INNER JOIN commerce_workspace_membership workspace_member
          ON workspace_member.tenant_id = tenant.id AND workspace_member.workspace_id = workspace.id
         AND workspace_member.user_id = $3 AND workspace_member.status = 'active'
        INNER JOIN commerce_enterprise_contract contract
          ON contract.tenant_id = tenant.id AND contract.status = 'active'
         AND contract.effective_from <= CURRENT_TIMESTAMP
         AND (contract.effective_until IS NULL OR contract.effective_until > CURRENT_TIMESTAMP)
        INNER JOIN commerce_agent_thread thread
          ON thread.tenant_id = tenant.id AND thread.workspace_id = workspace.id
         AND thread.thread_id = $4 AND thread.created_by_user_id = $3
        CROSS JOIN permission_state
        WHERE organization.id = $5 AND organization.status = 'active'
          AND permission_state.allowed AND NOT permission_state.denied
        LIMIT 1
      `,
      [scope.tenantId, scope.workspaceId, scope.userId, scope.rootThreadId, organizationId],
    );
    const authorization = result.rows[0];
    if (!authorization) return false;
    if (
      scope.runtimeMaxAgentThreads !== undefined &&
      scope.runtimeMaxAgentThreads > authorization.max_agent_threads_per_session
    ) {
      return false;
    }
    const periodStart = billingPeriodStart(authorization.billing_anchor_day);
    const usage = await client.query<{
      total_tokens: string;
      model_requests: string;
      missing_usage_events: string;
    }>(
      `
        SELECT COALESCE(sum(total_tokens), 0)::text AS total_tokens,
               count(*)::text AS model_requests,
               count(*) FILTER (WHERE usage_status = 'missing')::text AS missing_usage_events
        FROM commerce_agent_usage_event
        WHERE tenant_id = $1 AND occurred_at >= $2
      `,
      [scope.tenantId, periodStart],
    );
    const current = usage.rows[0];
    if (!current || Number.parseInt(current.missing_usage_events, 10) > 0) return false;
    if (
      authorization.monthly_total_token_limit !== null &&
      Number.parseInt(current.total_tokens, 10) >= Number.parseInt(authorization.monthly_total_token_limit, 10)
    ) {
      return false;
    }
    if (
      authorization.monthly_model_request_limit !== null &&
      Number.parseInt(current.model_requests, 10) >= Number.parseInt(authorization.monthly_model_request_limit, 10)
    ) {
      return false;
    }
    return true;
  });
}
