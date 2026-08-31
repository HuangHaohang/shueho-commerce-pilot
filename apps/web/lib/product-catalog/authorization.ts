import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";

export const PRODUCT_CATALOG_PERMISSIONS = [
  "product_catalog.read",
  "product_catalog.import",
  "product_catalog.review",
  "product_catalog.sources.manage",
] as const;

export type ProductCatalogPermission = (typeof PRODUCT_CATALOG_PERMISSIONS)[number];

export type ProductCatalogAuthorizationScope = EnterpriseScope & {
  rootThreadId?: string | null;
};

export async function authorizeProductCatalogAction(
  scope: ProductCatalogAuthorizationScope,
  permission: ProductCatalogPermission,
): Promise<boolean> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<{ authorized: boolean }>(
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
            COALESCE(bool_or($4 = ANY(allowed_permissions)), false) AS allowed,
            COALESCE(bool_or($4 = ANY(denied_permissions)), false) AS denied
          FROM effective_roles
        )
        SELECT EXISTS (
          SELECT 1
          FROM commerce_tenant tenant
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
          CROSS JOIN permission_state
          WHERE tenant.id = $1 AND tenant.status = 'active'
            AND permission_state.allowed
            AND NOT permission_state.denied
            AND (
              $5::text IS NULL
              OR EXISTS (
                SELECT 1
                FROM commerce_agent_thread thread
                WHERE thread.thread_id = $5
                  AND thread.tenant_id = $1
                  AND thread.workspace_id = $2
                  AND thread.created_by_user_id = $3
              )
            )
        ) AS authorized
      `,
      [scope.tenantId, scope.workspaceId, scope.userId, permission, scope.rootThreadId ?? null],
    );
    return result.rows[0]?.authorized === true;
  });
}

export async function recordProductCatalogApprovalEvidence(
  scope: ProductCatalogAuthorizationScope,
  input: {
    importId: string;
    mappingRevisionId: string;
    idempotencyKey: string;
    approvalRequestId: string;
    approvalItemId: string;
    turnId: string;
    approvedAt: string;
  },
): Promise<void> {
  await withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query(
      `INSERT INTO commerce_enterprise_audit_event
        (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
       VALUES ($1,$2,$3,'product_catalog.import.approval','product_import',$4,'allowed',$5::jsonb)`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        input.importId,
        JSON.stringify({
          mappingRevisionId: input.mappingRevisionId,
          idempotencyKey: input.idempotencyKey,
          approvalRequestId: input.approvalRequestId,
          approvalItemId: input.approvalItemId,
          rootThreadId: scope.rootThreadId ?? null,
          turnId: input.turnId,
          approvedAt: input.approvedAt,
        }),
      ],
    );
  });
}

export async function recordProductCatalogManagementApprovalEvidence(
  scope: ProductCatalogAuthorizationScope,
  input: {
    action:
      | "create_import_from_artifact"
      | "create_source_draft"
      | "test_source"
      | "propose_mapping"
      | "validate_mapping";
    targetType:
      | "thread_artifact"
      | "product_source_request"
      | "product_source"
      | "product_import"
      | "product_mapping";
    targetId: string;
    idempotencyKey: string;
    approvalRequestId: string;
    approvalItemId: string;
    turnId: string;
    approvedAt: string;
    connectorKey?: string | null;
    connectorVersion?: string | null;
  },
): Promise<void> {
  await withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query(
      `INSERT INTO commerce_enterprise_audit_event
        (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,'allowed',$7::jsonb)`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        `product_catalog.${input.action}.approval`,
        input.targetType,
        input.targetId,
        JSON.stringify({
          idempotencyKey: input.idempotencyKey,
          approvalRequestId: input.approvalRequestId,
          approvalItemId: input.approvalItemId,
          rootThreadId: scope.rootThreadId ?? null,
          turnId: input.turnId,
          approvedAt: input.approvedAt,
          ...(input.connectorKey ? { connectorKey: input.connectorKey } : {}),
          ...(input.connectorVersion ? { connectorVersion: input.connectorVersion } : {}),
        }),
      ],
    );
  });
}
