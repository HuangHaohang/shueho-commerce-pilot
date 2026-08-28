import nextEnv from "@next/env";
import { config as loadDotenv } from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";

import type { EnterprisePermission } from "../lib/enterprise/permissions";
import type { EnterpriseContext } from "../lib/enterprise/types";

nextEnv.loadEnvConfig(process.cwd());
loadDotenv({ path: resolve(process.cwd(), ".env.migration"), override: false, quiet: true });

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!process.env.DATABASE_URL || !migrationUrl || process.env.DATABASE_URL === migrationUrl) {
  throw new Error("External-data verification requires distinct DATABASE_URL and MIGRATION_DATABASE_URL values.");
}

const suffix = randomUUID();
const userId = `external-verify-${suffix}`;
const organizationId = randomUUID();
const tenantId = randomUUID();
const workspaceId = randomUUID();
const roleId = randomUUID();
const threadId = `thread-${suffix}`;
const providerImportId = randomUUID();
const providerSourceHash = createHash("sha256").update(`external-provider-${suffix}`).digest("hex");
const owner = new Pool({ connectionString: migrationUrl, max: 1 });

try {
  await createFixtures();
  const {
    approveExternalDataCall,
    cancelExternalDataCall,
    dispatchExternalDataCall,
    getExternalDataGovernance,
    quoteExternalDataPlan,
    reserveExternalDataCall,
    settleExternalDataCall,
    updateExternalDataPolicy,
    upsertExternalDataRateCard,
  } = await import("../lib/enterprise/external-data");
  const {
    authenticateMcpAccessTokenDigest,
    createMcpAccessToken,
    revokeMcpAccessToken,
  } = await import("../lib/enterprise/mcp-access-tokens");

  const externalPermissions: EnterprisePermission[] = [
    "external_data.catalog.read",
    "external_data.call",
    "external_data.policy.manage",
    "external_data.usage.read",
    "mcp.access_token.manage",
  ];
  const context: EnterpriseContext = {
    userId,
    organizationId,
    organizationSlug: `external-verify-${suffix}`,
    organizationName: "External Verify",
    organizationStatus: "active" as const,
    tenantId,
    tenantSlug: `external-verify-${suffix}`,
    tenantName: "External Verify",
    tenantStatus: "active" as const,
    workspaceId,
    workspaceSlug: "default",
    workspaceName: "Default",
    roleKeys: ["tenant_owner", "workspace_owner"],
    permissions: new Set(externalPermissions),
    tenantPermissions: new Set(externalPermissions),
    contract: {
      status: "active" as const,
      seatLimit: 5,
      workspaceLimit: 2,
      monthlyTotalTokenLimit: 1_000_000,
      monthlyModelRequestLimit: 10_000,
      concurrentTurnLimit: 4,
      concurrentTurnLimitPerWorkspace: 4,
      concurrentTurnLimitPerUser: 2,
      tokenReservationPerTurn: 50_000,
      maxAgentThreadsPerSession: 4,
      billingAnchorDay: 1,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveUntil: null,
    },
  };
  const scope = { tenantId, workspaceId, userId, rootThreadId: threadId, mcpAccessTokenId: null };
  const marketplacePlanId = randomUUID();
  const workflowStepInstanceId = randomUUID();
  const marketplacePlanKey = createHash("sha256").update(`marketplace-plan-${suffix}`).digest("hex");
  await updateExternalDataPolicy(context, {
    status: "enabled",
    approvalMode: "always_ask",
    allowedPlatforms: ["taobao"],
    allowedEndpointIds: [],
    monthlyCallLimit: 100,
    monthlySpendLimitMicros: null,
    perCallAutoApprovalMicros: null,
    perTurnCallLimit: null,
    retentionDays: 180,
  });
  const quote = await quoteExternalDataPlan(scope, {
    planId: marketplacePlanId,
    planKey: marketplacePlanKey,
    source: "codex_harness",
    threadId,
    turnId: "turn-verify-0001",
    calls: [{ endpointId: "taobao.verify_v1",platform: "taobao",count: 1 }],
  });
  assert(quote.providerCallCount === 1 && quote.unpricedEndpointIds.includes("taobao.verify_v1"),
    "plan quote did not preserve unpriced call coverage");
  const first = await reserveExternalDataCall(scope, {
    source: "codex_harness",
    threadId,
    turnId: "turn-verify-0001",
    callId: "call-verify-0001",
    endpointId: "taobao.verify_v1",
    platform: "taobao",
    parameterHash: "ab".repeat(32),
    parameterKeys: ["keyword"],
    requestedApprovalMode: "always_ask",
    marketplacePlanId,
    workflowStepInstanceId,
    workflowTargetId: null,
    workflowRole: "discovery",
  });
  assert(first.requiresApproval && first.pricingStatus === "unpriced", "default reservation did not require approval");
  await approveExternalDataCall(scope, first.reservationId);
  await dispatchExternalDataCall(scope, first.reservationId, {
    endpoint_id: "taobao.verify_v1",
    params: { keyword: "通勤包" },
    marketplace_plan_id: marketplacePlanId,
    workflow_step_instance_id: workflowStepInstanceId,
    workflow_target_id: null,
  });
  await settleExternalDataCall(scope, first.reservationId, {
    state: "succeeded",
    upstreamCode: 0,
    upstreamMessage: null,
    resultBytes: 256,
    responsePayload: {
      code: 0,
      message: null,
      data: [{ id: "verification-record", title: "验证记录" }],
      recordTime: new Date().toISOString(),
      requestId: "verification-request",
    },
  });
  const planLineage = await owner.query<{
    marketplace_plan_id: string | null; workflow_step_instance_id: string | null; workflow_role: string | null;
  }>(`
    SELECT marketplace_plan_id,workflow_step_instance_id,workflow_role
    FROM commerce_external_data_call WHERE id=$1
  `,[first.reservationId]);
  assert(planLineage.rows[0]?.marketplace_plan_id === marketplacePlanId &&
    planLineage.rows[0]?.workflow_step_instance_id === workflowStepInstanceId &&
    planLineage.rows[0]?.workflow_role === "discovery","plan call lineage was not retained");
  const archived = await owner.query<{
    state: string;
    request_payload: Record<string, unknown>;
    response_payload: Record<string, unknown> | null;
    request_sha256: string;
    response_sha256: string | null;
    retention_until: Date | null;
  }>(
    `SELECT state, request_payload, response_payload,
            request_sha256, response_sha256, retention_until
     FROM commerce_external_data_archive
     WHERE tenant_id = $1 AND source = 'codex_harness' AND source_call_id = 'call-verify-0001'`,
    [tenantId],
  );
  assert(
    archived.rows[0]?.state === "succeeded" &&
      archived.rows[0]?.request_payload.endpoint_id === "taobao.verify_v1" &&
      archived.rows[0]?.response_payload?.requestId === "verification-request" &&
      /^[a-f0-9]{64}$/.test(archived.rows[0]?.request_sha256 || "") &&
      /^[a-f0-9]{64}$/.test(archived.rows[0]?.response_sha256 || "") &&
      archived.rows[0]?.retention_until instanceof Date,
    "complete request/response archive was not persisted with independent retention",
  );
  const archiveView = await owner.query<{
    keyword: string | null;
    response_data: unknown;
  }>(
    `SELECT keyword, response_data
     FROM commerce_external_data_search_v1_archive
     WHERE tenant_id = $1 AND source_call_id = 'call-verify-0001'`,
    [tenantId],
  );
  assert(
    archiveView.rowCount === 0,
    "a non-search endpoint appeared in the SQL-only search_v1 archive view",
  );
  let deniedPlatform = false;
  try {
    await reserveExternalDataCall(scope, {
      source: "codex_harness",
      threadId,
      turnId: "turn-verify-denied",
      callId: "call-verify-denied",
      endpointId: "weibo.verify_v1",
      platform: "weibo",
      parameterHash: "ef".repeat(32),
      parameterKeys: ["keyword"],
      requestedApprovalMode: "always_ask",
    });
  } catch (error) {
    deniedPlatform = error instanceof Error && "code" in error && error.code === "EXTERNAL_DATA_PLATFORM_DENIED";
  }
  assert(deniedPlatform, "platform policy denial was not enforced");

  await updateExternalDataPolicy(context, {
    status: "enabled",
    approvalMode: "policy",
    allowedPlatforms: ["taobao"],
    allowedEndpointIds: [],
    monthlyCallLimit: 100,
    monthlySpendLimitMicros: 100_000_000,
    perCallAutoApprovalMicros: 2_000_000,
    perTurnCallLimit: 1,
    retentionDays: null,
  });
  let deniedUnpricedBudget = false;
  try {
    await reserveExternalDataCall(scope, {
      source: "codex_harness",
      threadId,
      turnId: "turn-verify-unpriced-budget",
      callId: "call-verify-unpriced-budget",
      endpointId: "taobao.unpriced_budget_v1",
      platform: "taobao",
      parameterHash: "34".repeat(32),
      parameterKeys: ["item_id"],
      requestedApprovalMode: "always_ask",
    });
  } catch (error) {
    deniedUnpricedBudget = error instanceof Error && "code" in error && error.code === "EXTERNAL_DATA_RATE_CARD_REQUIRED";
  }
  assert(deniedUnpricedBudget, "an unpriced call bypassed the configured monetary budget");
  const providerPriced = await reserveExternalDataCall(scope, {
    source: "codex_harness",
    threadId,
    turnId: "turn-verify-provider-price",
    callId: "call-verify-provider-price",
    endpointId: "taobao.policy_v1",
    platform: "taobao",
    parameterHash: "56".repeat(32),
    parameterKeys: ["item_id"],
    requestedApprovalMode: "always_ask",
  });
  assert(
    providerPriced.requiresApproval &&
      providerPriced.pricingStatus === "priced" &&
      providerPriced.billableAmountMicros === 500_000,
    "always-ask mode or provider pricing master was not enforced",
  );
  await cancelExternalDataCall(scope, providerPriced.reservationId, "upstream_unavailable");
  const taskAuthorized = await reserveExternalDataCall(scope, {
    source: "codex_harness",
    threadId,
    turnId: "turn-verify-task-grant",
    callId: "call-verify-task-grant",
    endpointId: "taobao.policy_v1",
    platform: "taobao",
    parameterHash: "78".repeat(32),
    parameterKeys: ["item_id"],
    requestedApprovalMode: "task",
  });
  assert(!taskAuthorized.requiresApproval, "current-task authorization still requested per-call approval");
  await cancelExternalDataCall(scope, taskAuthorized.reservationId, "upstream_unavailable");
  await upsertExternalDataRateCard(context, {
    endpointId: "taobao.policy_v1",
    vendorUnitCostMicros: 500_000,
    customerUnitPriceMicros: 1_000_000,
  });
  const second = await reserveExternalDataCall(scope, {
    source: "codex_harness",
    threadId,
    turnId: "turn-verify-0002",
    callId: "call-verify-0002",
    endpointId: "taobao.policy_v1",
    platform: "taobao",
    parameterHash: "cd".repeat(32),
    parameterKeys: ["item_id"],
    requestedApprovalMode: "policy",
  });
  assert(!second.requiresApproval && second.billableAmountMicros === 1_000_000, "priced policy call was not auto-approved");
  let deniedTurnLimit = false;
  try {
    await reserveExternalDataCall(scope, {
      source: "codex_harness",
      threadId,
      turnId: "turn-verify-0002",
      callId: "call-verify-turn-limit",
      endpointId: "taobao.policy_v1",
      platform: "taobao",
      parameterHash: "12".repeat(32),
      parameterKeys: ["item_id"],
      requestedApprovalMode: "policy",
    });
  } catch (error) {
    deniedTurnLimit = error instanceof Error && "code" in error && error.code === "EXTERNAL_DATA_TURN_CALL_LIMIT";
  }
  assert(deniedTurnLimit, "per-Turn external-data call limit was not enforced");
  await cancelExternalDataCall(scope, second.reservationId, "upstream_unavailable");

  const governance = await getExternalDataGovernance(context);
  assert(governance.usage.succeededCalls === 1, "settled usage was not counted");
  assert(governance.usage.unpricedCalls === 1, "unpriced usage was not surfaced");
  assert(governance.rateCards.length === 1, "rate-card readback failed");
  assert(governance.policy.perTurnCallLimit === 1, "per-Turn call limit readback failed");
  assert(governance.policy.retentionDays === null, "permanent metadata retention readback failed");

  const createdToken = await createMcpAccessToken(context, {
    name: "verification",
    scopes: ["external_data.catalog.read", "external_data.call"],
    expiresInDays: 1,
  });
  const authenticated = await authenticateMcpAccessTokenDigest(
    createdToken.prefix,
    createHash("sha256").update(createdToken.token).digest("hex"),
  );
  assert(authenticated?.tokenId === createdToken.id, "MCP token digest authentication failed");
  await revokeMcpAccessToken(context, createdToken.id, true);
  const revoked = await authenticateMcpAccessTokenDigest(
    createdToken.prefix,
    createHash("sha256").update(createdToken.token).digest("hex"),
  );
  assert(revoked === null, "revoked MCP token remained valid");

  const audit = await owner.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM commerce_enterprise_audit_event WHERE tenant_id = $1`,
    [tenantId],
  );
  assert(Number.parseInt(audit.rows[0]?.count || "0", 10) >= 8, "external-data audit events were not persisted");
  await owner.query(`DELETE FROM commerce_agent_thread WHERE thread_id = $1`, [threadId]);
  const archiveAfterThreadDeletion = await owner.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM commerce_external_data_archive
     WHERE tenant_id = $1 AND source_call_id = 'call-verify-0001'`,
    [tenantId],
  );
  assert(
    archiveAfterThreadDeletion.rows[0]?.count === "1",
    "thread deletion cascaded into the independent external-data archive",
  );

  console.log(JSON.stringify({
    ok: true,
    stateMachine: "reserve-approve-dispatch-settle",
    noReservationPlanQuoteReadback: true,
    planStepLineageReadback: true,
    pricedPolicyReadback: true,
    taskGrantReadback: true,
    perTurnCallLimitReadback: true,
    permanentMetadataRetentionReadback: true,
    unpricedBudgetBypassDenied: true,
    providerPricingFallbackReadback: true,
    fullArchiveReadback: true,
    sqlOnlySearchViewReadback: true,
    threadDeletionIndependence: true,
    mcpTokenLifecycle: "created-authenticated-revoked",
    auditReadback: true,
    deniedAuditReadback: true,
  }));
} finally {
  await owner.query(`DELETE FROM commerce_external_provider_endpoint WHERE source_import_id = $1`, [providerImportId]).catch(() => undefined);
  await owner.query(`DELETE FROM commerce_external_provider_import WHERE id = $1`, [providerImportId]).catch(() => undefined);
  await owner.query(`DELETE FROM commerce_tenant WHERE id = $1`, [tenantId]).catch(() => undefined);
  await owner.query(`DELETE FROM commerce_organization WHERE id = $1`, [organizationId]).catch(() => undefined);
  await owner.query(`DELETE FROM "user" WHERE id = $1`, [userId]).catch(() => undefined);
  const { getAuthDatabase } = await import("../lib/auth/database");
  await Promise.all([owner.end(), getAuthDatabase().end()]);
}

async function createFixtures(): Promise<void> {
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, 'External Verify', $2, true)`,
      [userId, `${userId}@example.test`],
    );
    await client.query(
      `INSERT INTO commerce_external_provider_import (
         id, provider, source_filename, source_sha256, source_exported_at,
         source_filter, source_search, currency, row_count, allowed_row_count,
         imported_by_user_id
       )
       VALUES ($1, 'justoneapi', 'verification.xlsx', $2, CURRENT_TIMESTAMP,
               '平台: 所有接口', '-', 'CNY', 1, 1, $3)`,
      [providerImportId, providerSourceHash, userId],
    );
    await client.query(
      `INSERT INTO commerce_external_provider_endpoint (
         provider, endpoint_id, platform_id, platform_name, api_path,
         currency, vendor_unit_cost_micros, permission_status,
         is_active, source_import_id, source_exported_at
       )
       VALUES ('justoneapi', 'taobao.policy_v1', 'taobao', '淘宝',
               '/api/taobao/policy/v1', 'CNY', 500000, 'allowed',
               true, $1, CURRENT_TIMESTAMP)`,
      [providerImportId],
    );
    await client.query(
      `INSERT INTO commerce_organization (id, slug, name, status, created_by_user_id)
       VALUES ($1, $2, 'External Verify', 'active', $3)`,
      [organizationId, `external-verify-${suffix}`, userId],
    );
    await client.query(
      `INSERT INTO commerce_tenant (id, organization_id, slug, name, status, created_by_user_id)
       VALUES ($1, $2, $3, 'External Verify', 'active', $4)`,
      [tenantId, organizationId, `external-verify-${suffix}`, userId],
    );
    await client.query(
      `INSERT INTO commerce_workspace (id, tenant_id, slug, name, status, is_default, created_by_user_id)
       VALUES ($1, $2, 'default', 'Default', 'active', true, $3)`,
      [workspaceId, tenantId, userId],
    );
    await client.query(
      `INSERT INTO commerce_tenant_membership (tenant_id, user_id, status, is_default, joined_at)
       VALUES ($1, $2, 'active', true, CURRENT_TIMESTAMP)`,
      [tenantId, userId],
    );
    await client.query(
      `INSERT INTO commerce_workspace_membership (tenant_id, workspace_id, user_id, status, is_default)
       VALUES ($1, $2, $3, 'active', true)`,
      [tenantId, workspaceId, userId],
    );
    await client.query(
      `INSERT INTO commerce_enterprise_contract
        (tenant_id, status, seat_limit, workspace_limit, monthly_total_token_limit,
         monthly_model_request_limit, concurrent_turn_limit,
         concurrent_turn_limit_per_workspace, concurrent_turn_limit_per_user)
       VALUES ($1, 'active', 5, 2, 1000000, 10000, 4, 4, 2)`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO commerce_enterprise_role
        (id, tenant_id, scope, role_key, name, allowed_permissions, is_system)
       VALUES ($1, $2, 'tenant', 'tenant_owner', 'Tenant owner',
               ARRAY[
                 'external_data.catalog.read', 'external_data.call', 'external_data.policy.manage',
                 'external_data.usage.read', 'mcp.access_token.manage'
               ]::text[], true)`,
      [roleId, tenantId],
    );
    await client.query(
      `INSERT INTO commerce_user_role_assignment
        (tenant_id, user_id, role_id, workspace_id, assigned_by_user_id)
       VALUES ($1, $2, $3, NULL, $2)`,
      [tenantId, userId, roleId],
    );
    await client.query(
      `INSERT INTO commerce_agent_thread
        (thread_id, user_id, created_by_user_id, tenant_id, workspace_id, title, status)
       VALUES ($1, $2, $2, $3, $4, 'External verification', 'running')`,
      [threadId, userId, tenantId, workspaceId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`External-data governance verification failed: ${message}`);
}
