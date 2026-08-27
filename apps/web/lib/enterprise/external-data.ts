import type { PoolClient } from "pg";

import { billingPeriodStart } from "@/lib/enterprise/billing-period";
import {
  recordExternalDataArchiveDispatch,
  recordExternalDataArchiveSettlement,
} from "@/lib/enterprise/external-data-archive";
import {
  withEnterpriseDatabaseContext,
  withEnterpriseTenantDatabaseContext,
} from "@/lib/enterprise/database-context";
import {
  EXTERNAL_DATA_APPROVAL_MODES,
  requiresExternalDataApproval,
  type ExternalDataApprovalMode,
} from "@/lib/enterprise/external-data-policy";
import type { EnterpriseContext, EnterpriseScope } from "@/lib/enterprise/types";

export { EXTERNAL_DATA_APPROVAL_MODES, requiresExternalDataApproval };
export type { ExternalDataApprovalMode };
export type ExternalDataCallSource = "codex_harness" | "external_mcp";
export type ExternalDataCallTerminalState = "succeeded" | "business_failed" | "unknown";

export type ExternalDataPolicyView = {
  status: "enabled" | "disabled";
  approvalMode: ExternalDataApprovalMode;
  allowedPlatforms: string[];
  allowedEndpointIds: string[];
  monthlyCallLimit: number;
  monthlySpendLimitMicros: number | null;
  perCallAutoApprovalMicros: number | null;
  perTurnCallLimit: number | null;
  currency: string;
  retentionDays: number | null;
};

export type ExternalDataRateCardView = {
  id: string;
  endpointId: string;
  vendorUnitCostMicros: number | null;
  customerUnitPriceMicros: number;
  currency: string;
  effectiveFrom: string;
};

export type ExternalDataUsageView = {
  periodStart: string;
  reservedCalls: number;
  dispatchedCalls: number;
  succeededCalls: number;
  failedCalls: number;
  unknownCalls: number;
  unpricedCalls: number;
  billableAmountMicros: number;
  vendorCostMicros: number;
};

export type ExternalDataGovernanceView = {
  policy: ExternalDataPolicyView;
  rateCards: ExternalDataRateCardView[];
  providerCatalog: {
    latestImport: {
      sourceFilename: string;
      sourceExportedAt: string;
      rowCount: number;
      allowedRowCount: number;
    } | null;
    platforms: Array<{ id: string; name: string; endpointCount: number }>;
    endpoints: Array<{
      endpointId: string;
      platformId: string;
      platformName: string;
      apiPath: string;
      vendorUnitCostMicros: number | null;
      currency: string;
      permissionStatus: "allowed" | "unavailable";
    }>;
  };
  usage: ExternalDataUsageView;
  recentCalls: Array<{
    id: string;
    endpointId: string;
    platform: string;
    source: ExternalDataCallSource;
    state: string;
    approvalState: string;
    pricingStatus: "priced" | "unpriced";
    billableAmountMicros: number | null;
    currency: string;
    upstreamCode: number | null;
    createdAt: string;
  }>;
};

export type ExternalDataCallScope = EnterpriseScope & {
  rootThreadId?: string | null;
  mcpAccessTokenId?: string | null;
};

export type ReserveExternalDataCallInput = {
  source: ExternalDataCallSource;
  threadId?: string | null;
  turnId?: string | null;
  callId: string;
  endpointId: string;
  platform: string;
  parameterHash: string;
  parameterKeys: string[];
  requestedApprovalMode: ExternalDataApprovalMode;
};

export type ExternalDataReservation = {
  reservationId: string;
  requiresApproval: boolean;
  approvalState: "pending" | "approved" | "not_required";
  pricingStatus: "priced" | "unpriced";
  currency: string;
  vendorCostMicros: number | null;
  billableAmountMicros: number | null;
  monthlyCallLimit: number;
  callsUsed: number;
  monthlySpendLimitMicros: number | null;
  spendUsedMicros: number;
};

export type ExternalDataCatalogAuthorization = {
  allowedPlatforms: string[];
  allowedEndpointIds: string[];
};

type PolicyRow = {
  status: ExternalDataPolicyView["status"];
  approval_mode: ExternalDataApprovalMode;
  allowed_platforms: string[];
  allowed_endpoint_ids: string[];
  monthly_call_limit: number;
  monthly_spend_limit_micros: string | number | null;
  per_call_auto_approval_micros: string | number | null;
  per_turn_call_limit: number | null;
  currency: string;
  retention_days: number | null;
};

type RateCardRow = {
  id: string;
  endpoint_id: string;
  vendor_unit_cost_micros: string | number | null;
  customer_unit_price_micros: string | number;
  currency: string;
  effective_from: Date;
};

export class ExternalDataGovernanceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExternalDataGovernanceError";
  }
}

export async function authorizeExternalDataCatalog(
  scope: EnterpriseScope,
): Promise<ExternalDataCatalogAuthorization> {
  return withEnterpriseTenantDatabaseContext(scope, async (client) => {
    if (!(await hasEffectivePermission(client, scope, "external_data.catalog.read"))) {
      throw new ExternalDataGovernanceError(
        "当前角色没有读取外部数据目录的权限。",
        "EXTERNAL_DATA_CATALOG_PERMISSION_DENIED",
        403,
      );
    }
    const policy = await ensurePolicy(client, scope.tenantId, scope.workspaceId);
    if (policy.status !== "enabled") {
      throw new ExternalDataGovernanceError("当前工作区未启用外部数据服务。", "EXTERNAL_DATA_DISABLED", 403);
    }
    return {
      allowedPlatforms: policy.allowed_platforms,
      allowedEndpointIds: policy.allowed_endpoint_ids,
    };
  }).catch(async (error) => {
    if (error instanceof ExternalDataGovernanceError) {
      await withEnterpriseTenantDatabaseContext(scope, async (client) => {
        await insertAudit(
          client,
          scope,
          "external_data.catalog.authorize",
          "external_data_policy",
          scope.workspaceId,
          "denied",
          { code: error.code },
        );
      }).catch(() => undefined);
    }
    throw error;
  });
}

export async function getExternalDataGovernance(
  context: EnterpriseContext,
): Promise<ExternalDataGovernanceView> {
  return withEnterpriseDatabaseContext(context, async (client) => {
    const policy = await ensurePolicy(client, context.tenantId, context.workspaceId);
    const cards = await client.query<RateCardRow>(
      `
        SELECT id, endpoint_id, vendor_unit_cost_micros, customer_unit_price_micros,
               currency, effective_from
        FROM commerce_external_data_rate_card
        WHERE tenant_id = $1 AND workspace_id = $2 AND provider = 'justoneapi'
          AND effective_from <= CURRENT_TIMESTAMP
          AND (effective_until IS NULL OR effective_until > CURRENT_TIMESTAMP)
        ORDER BY endpoint_id
      `,
      [context.tenantId, context.workspaceId],
    );
    const latestProviderImport = await client.query<{
      source_filename: string;
      source_exported_at: Date;
      row_count: number;
      allowed_row_count: number;
    }>(
      `SELECT source_filename, source_exported_at, row_count, allowed_row_count
       FROM commerce_external_provider_import
       WHERE provider = 'justoneapi'
       ORDER BY source_exported_at DESC, created_at DESC
       LIMIT 1`,
    );
    const providerEndpoints = await client.query<{
      endpoint_id: string;
      platform_id: string;
      platform_name: string;
      api_path: string;
      vendor_unit_cost_micros: string | number | null;
      currency: string;
      permission_status: "allowed" | "unavailable";
    }>(
      `SELECT endpoint_id, platform_id, platform_name, api_path,
              vendor_unit_cost_micros, currency, permission_status
       FROM commerce_external_provider_endpoint
       WHERE provider = 'justoneapi' AND is_active = true
       ORDER BY platform_name, api_path`,
    );
    const periodStart = billingPeriodStart(context.contract.billingAnchorDay);
    const recentCalls = await client.query<{
      id: string;
      endpoint_id: string;
      platform: string;
      source: ExternalDataCallSource;
      state: string;
      approval_state: string;
      pricing_status: "priced" | "unpriced";
      billable_amount_micros: string | number | null;
      currency: string;
      upstream_code: number | null;
      created_at: Date;
    }>(
      `
        SELECT id, endpoint_id, platform, source, state, approval_state,
               pricing_status, billable_amount_micros, currency, upstream_code, created_at
        FROM commerce_external_data_call
        WHERE tenant_id = $1 AND workspace_id = $2
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [context.tenantId, context.workspaceId],
    );
    const usage = await client.query<{
      reserved_calls: string;
      dispatched_calls: string;
      succeeded_calls: string;
      failed_calls: string;
      unknown_calls: string;
      unpriced_calls: string;
      billable_amount_micros: string;
      vendor_cost_micros: string;
    }>(
      `
        SELECT
          count(*) FILTER (WHERE state = 'reserved')::text AS reserved_calls,
          count(*) FILTER (WHERE state = 'dispatched')::text AS dispatched_calls,
          count(*) FILTER (WHERE state = 'succeeded')::text AS succeeded_calls,
          count(*) FILTER (WHERE state = 'business_failed')::text AS failed_calls,
          count(*) FILTER (WHERE state = 'unknown')::text AS unknown_calls,
          count(*) FILTER (WHERE state = 'succeeded' AND pricing_status = 'unpriced')::text AS unpriced_calls,
          COALESCE(sum(billable_amount_micros) FILTER (WHERE state = 'succeeded'), 0)::text
            AS billable_amount_micros,
          COALESCE(sum(vendor_cost_micros) FILTER (WHERE state = 'succeeded'), 0)::text
            AS vendor_cost_micros
        FROM commerce_external_data_call
        WHERE tenant_id = $1 AND workspace_id = $2 AND created_at >= $3
      `,
      [context.tenantId, context.workspaceId, periodStart],
    );
    const totals = usage.rows[0];
    return {
      policy: toPolicyView(policy),
      rateCards: cards.rows.map(toRateCardView),
      providerCatalog: {
        latestImport: latestProviderImport.rows[0]
          ? {
              sourceFilename: latestProviderImport.rows[0].source_filename,
              sourceExportedAt: latestProviderImport.rows[0].source_exported_at.toISOString(),
              rowCount: latestProviderImport.rows[0].row_count,
              allowedRowCount: latestProviderImport.rows[0].allowed_row_count,
            }
          : null,
        platforms: summarizeProviderPlatforms(providerEndpoints.rows),
        endpoints: providerEndpoints.rows.map((row) => ({
          endpointId: row.endpoint_id,
          platformId: row.platform_id,
          platformName: row.platform_name,
          apiPath: row.api_path,
          vendorUnitCostMicros: nullableNumber(row.vendor_unit_cost_micros),
          currency: row.currency,
          permissionStatus: row.permission_status,
        })),
      },
      usage: {
        periodStart: periodStart.toISOString(),
        reservedCalls: parseCount(totals?.reserved_calls),
        dispatchedCalls: parseCount(totals?.dispatched_calls),
        succeededCalls: parseCount(totals?.succeeded_calls),
        failedCalls: parseCount(totals?.failed_calls),
        unknownCalls: parseCount(totals?.unknown_calls),
        unpricedCalls: parseCount(totals?.unpriced_calls),
        billableAmountMicros: parseCount(totals?.billable_amount_micros),
        vendorCostMicros: parseCount(totals?.vendor_cost_micros),
      },
      recentCalls: recentCalls.rows.map((row) => ({
        id: row.id,
        endpointId: row.endpoint_id,
        platform: row.platform,
        source: row.source,
        state: row.state,
        approvalState: row.approval_state,
        pricingStatus: row.pricing_status,
        billableAmountMicros: nullableNumber(row.billable_amount_micros),
        currency: row.currency,
        upstreamCode: row.upstream_code,
        createdAt: row.created_at.toISOString(),
      })),
    };
  });
}

export async function updateExternalDataPolicy(
  context: EnterpriseContext,
  input: Omit<ExternalDataPolicyView, "currency"> & { currency?: string },
): Promise<ExternalDataPolicyView> {
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    await assertProviderPolicySelection(client, input.allowedPlatforms, input.allowedEndpointIds);
    const result = await client.query<PolicyRow>(
      `
        INSERT INTO commerce_external_data_policy (
          tenant_id, workspace_id, provider, status, approval_mode,
          allowed_platforms, allowed_endpoint_ids, monthly_call_limit,
          monthly_spend_limit_micros, per_call_auto_approval_micros,
          per_turn_call_limit, currency, retention_days, updated_by_user_id
        )
        VALUES ($1, $2, 'justoneapi', $3, $4, $5::text[], $6::text[], $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (tenant_id, workspace_id, provider) DO UPDATE
        SET status = EXCLUDED.status,
            approval_mode = EXCLUDED.approval_mode,
            allowed_platforms = EXCLUDED.allowed_platforms,
            allowed_endpoint_ids = EXCLUDED.allowed_endpoint_ids,
            monthly_call_limit = EXCLUDED.monthly_call_limit,
            monthly_spend_limit_micros = EXCLUDED.monthly_spend_limit_micros,
            per_call_auto_approval_micros = EXCLUDED.per_call_auto_approval_micros,
            per_turn_call_limit = EXCLUDED.per_turn_call_limit,
            currency = EXCLUDED.currency,
            retention_days = EXCLUDED.retention_days,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = CURRENT_TIMESTAMP
        RETURNING status, approval_mode, allowed_platforms, allowed_endpoint_ids,
                  monthly_call_limit, monthly_spend_limit_micros,
                  per_call_auto_approval_micros, per_turn_call_limit,
                  currency, retention_days
      `,
      [
        context.tenantId,
        context.workspaceId,
        input.status,
        input.approvalMode,
        input.allowedPlatforms,
        input.allowedEndpointIds,
        input.monthlyCallLimit,
        input.monthlySpendLimitMicros,
        input.perCallAutoApprovalMicros,
        input.perTurnCallLimit,
        input.currency || "CNY",
        input.retentionDays,
        context.userId,
      ],
    );
    await insertAudit(client, context, "external_data.policy.update", "external_data_policy", context.workspaceId, "succeeded", {
      approvalMode: input.approvalMode,
      platformCount: input.allowedPlatforms.length,
      endpointCount: input.allowedEndpointIds.length,
      monthlyCallLimit: input.monthlyCallLimit,
      perTurnCallLimit: input.perTurnCallLimit,
      monetaryBudgetConfigured: input.monthlySpendLimitMicros !== null,
    });
    return toPolicyView(result.rows[0] ?? await ensurePolicy(client, context.tenantId, context.workspaceId));
  });
}

export async function upsertExternalDataRateCard(
  context: EnterpriseContext,
  input: {
    endpointId: string;
    vendorUnitCostMicros: number | null;
    customerUnitPriceMicros: number;
    currency?: string;
  },
): Promise<ExternalDataRateCardView> {
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `external-rate:${context.tenantId}:${context.workspaceId}:${input.endpointId}`,
    ]);
    await client.query(
      `
        UPDATE commerce_external_data_rate_card
        SET effective_until = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND workspace_id = $2 AND provider = 'justoneapi'
          AND endpoint_id = $3 AND effective_until IS NULL
      `,
      [context.tenantId, context.workspaceId, input.endpointId],
    );
    const result = await client.query<RateCardRow>(
      `
        INSERT INTO commerce_external_data_rate_card (
          tenant_id, workspace_id, provider, endpoint_id, vendor_unit_cost_micros,
          customer_unit_price_micros, currency, created_by_user_id
        )
        VALUES ($1, $2, 'justoneapi', $3, $4, $5, $6, $7)
        RETURNING id, endpoint_id, vendor_unit_cost_micros,
                  customer_unit_price_micros, currency, effective_from
      `,
      [
        context.tenantId,
        context.workspaceId,
        input.endpointId,
        input.vendorUnitCostMicros,
        input.customerUnitPriceMicros,
        input.currency || "CNY",
        context.userId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("External data rate card insert returned no row.");
    await insertAudit(client, context, "external_data.rate_card.set", "external_data_endpoint", input.endpointId, "succeeded", {
      currency: row.currency,
      customerUnitPriceMicros: Number(row.customer_unit_price_micros),
      vendorCostConfigured: row.vendor_unit_cost_micros !== null,
    });
    return toRateCardView(row);
  });
}

export async function retireExternalDataRateCard(
  context: EnterpriseContext,
  rateCardId: string,
): Promise<void> {
  await withEnterpriseTenantDatabaseContext(context, async (client) => {
    const result = await client.query<{ endpoint_id: string }>(
      `
        UPDATE commerce_external_data_rate_card
        SET effective_until = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND effective_until IS NULL
        RETURNING endpoint_id
      `,
      [rateCardId, context.tenantId, context.workspaceId],
    );
    const endpointId = result.rows[0]?.endpoint_id;
    if (!endpointId) {
      throw new ExternalDataGovernanceError("费率记录不存在。", "RATE_CARD_NOT_FOUND", 404);
    }
    await insertAudit(client, context, "external_data.rate_card.retire", "external_data_endpoint", endpointId, "succeeded", {});
  });
}

export async function reserveExternalDataCall(
  scope: ExternalDataCallScope,
  input: ReserveExternalDataCallInput,
): Promise<ExternalDataReservation> {
  validateCallIdentity(input);
  return withEnterpriseTenantDatabaseContext(scope, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `external-call:${scope.tenantId}:${input.source}:${input.callId}`,
    ]);
    if (!(await hasEffectivePermission(client, scope, "external_data.call"))) {
      throw new ExternalDataGovernanceError(
        "当前角色没有调用外部付费数据源的权限。",
        "EXTERNAL_DATA_PERMISSION_DENIED",
        403,
      );
    }
    const policy = await ensurePolicy(client, scope.tenantId, scope.workspaceId, true);
    if (policy.status !== "enabled") {
      throw new ExternalDataGovernanceError("当前工作区未启用外部数据服务。", "EXTERNAL_DATA_DISABLED", 403);
    }
    if (!policy.allowed_platforms.includes(input.platform)) {
      throw new ExternalDataGovernanceError("该数据平台未被企业策略允许。", "EXTERNAL_DATA_PLATFORM_DENIED", 403);
    }
    if (policy.allowed_endpoint_ids.length > 0 && !policy.allowed_endpoint_ids.includes(input.endpointId)) {
      throw new ExternalDataGovernanceError("该接口未被企业策略允许。", "EXTERNAL_DATA_ENDPOINT_DENIED", 403);
    }

    const existing = await client.query<{
      id: string;
      endpoint_id: string;
      parameter_hash: string;
      state: string;
      approval_state: ExternalDataReservation["approvalState"];
      pricing_status: ExternalDataReservation["pricingStatus"];
      currency: string;
      vendor_cost_micros: string | number | null;
      billable_amount_micros: string | number | null;
    }>(
      `
        SELECT id, endpoint_id, parameter_hash, state, approval_state, pricing_status,
               currency, vendor_cost_micros, billable_amount_micros
        FROM commerce_external_data_call
        WHERE tenant_id = $1 AND source = $2 AND call_id = $3
        LIMIT 1
      `,
      [scope.tenantId, input.source, input.callId],
    );
    const existingCall = existing.rows[0];
    if (existingCall) {
      if (existingCall.endpoint_id !== input.endpointId || existingCall.parameter_hash !== input.parameterHash) {
        throw new ExternalDataGovernanceError("调用标识已绑定到其他参数。", "EXTERNAL_DATA_IDEMPOTENCY_CONFLICT", 409);
      }
      if (existingCall.state !== "reserved") {
        throw new ExternalDataGovernanceError("该外部数据调用已经处理，不能重复发送。", "EXTERNAL_DATA_REPLAY_DENIED", 409);
      }
      const usage = await readPeriodUsage(client, scope, policy);
      return reservationView(existingCall, policy, usage);
    }

    const rateCard = await readEffectiveRate(client, scope, input.endpointId);
    const usage = await readPeriodUsage(client, scope, policy);
    if (usage.callsUsed >= policy.monthly_call_limit) {
      throw new ExternalDataGovernanceError("本计费周期的外部数据调用额度已用尽。", "EXTERNAL_DATA_CALL_LIMIT", 429);
    }
    if (input.source === "codex_harness" && policy.per_turn_call_limit !== null) {
      const turnUsage = await client.query<{ calls_used: string }>(
        `
          SELECT count(*)::text AS calls_used
          FROM commerce_external_data_call
          WHERE tenant_id = $1 AND workspace_id = $2
            AND source = 'codex_harness' AND thread_id = $3 AND turn_id = $4
            AND state <> 'cancelled'
        `,
        [scope.tenantId, scope.workspaceId, input.threadId, input.turnId],
      );
      if (parseCount(turnUsage.rows[0]?.calls_used) >= policy.per_turn_call_limit) {
        throw new ExternalDataGovernanceError(
          `当前任务最多允许 ${policy.per_turn_call_limit} 次外部数据调用。已停止调用，不会自动重试。`,
          "EXTERNAL_DATA_TURN_CALL_LIMIT",
          429,
        );
      }
    }
    if (!rateCard && policy.monthly_spend_limit_micros !== null) {
      throw new ExternalDataGovernanceError(
        "企业已设置外部数据金额预算，但该接口尚未配置费率。为避免绕过预算，本次调用已停止。",
        "EXTERNAL_DATA_RATE_CARD_REQUIRED",
        409,
      );
    }
    const price = rateCard ? Number(rateCard.customer_unit_price_micros) : null;
    if (
      price !== null &&
      policy.monthly_spend_limit_micros !== null &&
      usage.spendUsedMicros + price > Number(policy.monthly_spend_limit_micros)
    ) {
      throw new ExternalDataGovernanceError("本计费周期的外部数据费用额度不足。", "EXTERNAL_DATA_SPEND_LIMIT", 402);
    }

    const requiresApproval = requiresExternalDataApproval(
      {
        approvalMode: policy.approval_mode,
        perCallAutoApprovalMicros: nullableNumber(policy.per_call_auto_approval_micros),
      },
      input.requestedApprovalMode,
      price,
    );
    const inserted = await client.query<{
      id: string;
      approval_state: ExternalDataReservation["approvalState"];
      pricing_status: ExternalDataReservation["pricingStatus"];
      currency: string;
      vendor_cost_micros: string | number | null;
      billable_amount_micros: string | number | null;
      endpoint_id: string;
      parameter_hash: string;
      state: string;
    }>(
      `
        INSERT INTO commerce_external_data_call (
          tenant_id, workspace_id, user_id, mcp_access_token_id, provider, source,
          root_thread_id, thread_id, turn_id, call_id, endpoint_id, platform,
          parameter_hash, parameter_keys, requested_approval_mode, approval_state,
          pricing_status, currency, vendor_cost_micros, billable_amount_micros
        )
        VALUES (
          $1, $2, $3, $4, 'justoneapi', $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13::text[], $14, $15,
          $16, $17, $18, $19
        )
        RETURNING id, approval_state, pricing_status, currency, vendor_cost_micros,
                  billable_amount_micros, endpoint_id, parameter_hash, state
      `,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        scope.mcpAccessTokenId ?? null,
        input.source,
        input.source === "codex_harness" ? scope.rootThreadId ?? null : null,
        input.source === "codex_harness" ? input.threadId ?? null : null,
        input.source === "codex_harness" ? input.turnId ?? null : null,
        input.callId,
        input.endpointId,
        input.platform,
        input.parameterHash,
        input.parameterKeys,
        input.requestedApprovalMode,
        requiresApproval ? "pending" : "not_required",
        rateCard ? "priced" : "unpriced",
        rateCard?.currency ?? policy.currency,
        rateCard?.vendor_unit_cost_micros ?? null,
        rateCard?.customer_unit_price_micros ?? null,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("External data reservation returned no row.");
    await insertAudit(client, scope, "external_data.call.reserve", "external_data_endpoint", input.endpointId, "allowed", {
      source: input.source,
      callId: input.callId,
      platform: input.platform,
      pricingStatus: row.pricing_status,
      requiresApproval,
      parameterKeys: input.parameterKeys,
    });
    return reservationView(row, policy, usage);
  }).catch(async (error) => {
    if (error instanceof ExternalDataGovernanceError) {
      await recordExternalDataDenial(scope, input, error).catch(() => undefined);
    }
    throw error;
  });
}

export async function approveExternalDataCall(
  scope: ExternalDataCallScope,
  reservationId: string,
): Promise<void> {
  await withEnterpriseTenantDatabaseContext(scope, async (client) => {
    if (!(await hasEffectivePermission(client, scope, "external_data.call"))) {
      throw new ExternalDataGovernanceError("外部数据权限已被撤销。", "EXTERNAL_DATA_PERMISSION_REVOKED", 403);
    }
    const result = await client.query<{ endpoint_id: string }>(
      `
        UPDATE commerce_external_data_call
        SET approval_state = 'approved', approved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4
          AND state = 'reserved' AND approval_state = 'pending'
        RETURNING endpoint_id
      `,
      [reservationId, scope.tenantId, scope.workspaceId, scope.userId],
    );
    const endpointId = result.rows[0]?.endpoint_id;
    if (!endpointId) {
      throw new ExternalDataGovernanceError("待审批调用不存在或状态已变化。", "EXTERNAL_DATA_APPROVAL_STALE", 409);
    }
    await insertAudit(client, scope, "external_data.call.approve", "external_data_endpoint", endpointId, "succeeded", {
      reservationId,
    });
  });
}

export async function dispatchExternalDataCall(
  scope: ExternalDataCallScope,
  reservationId: string,
  requestPayload: Record<string, unknown>,
): Promise<void> {
  await withEnterpriseTenantDatabaseContext(scope, async (client) => {
    if (!(await hasEffectivePermission(client, scope, "external_data.call"))) {
      throw new ExternalDataGovernanceError("外部数据权限已被撤销。", "EXTERNAL_DATA_PERMISSION_REVOKED", 403);
    }
    const policy = await ensurePolicy(client, scope.tenantId, scope.workspaceId);
    const result = await client.query<{
      id: string;
      endpoint_id: string;
      platform: string;
      source: ExternalDataCallSource;
      call_id: string;
      root_thread_id: string | null;
      thread_id: string | null;
      turn_id: string | null;
    }>(
      `
        UPDATE commerce_external_data_call
        SET state = 'dispatched', dispatched_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4
          AND state = 'reserved' AND approval_state IN ('approved', 'not_required')
        RETURNING id, endpoint_id, platform, source, call_id,
                  root_thread_id, thread_id, turn_id
      `,
      [reservationId, scope.tenantId, scope.workspaceId, scope.userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ExternalDataGovernanceError("外部数据调用未获准或已发送。", "EXTERNAL_DATA_DISPATCH_DENIED", 409);
    }
    const archiveId = await recordExternalDataArchiveDispatch(client, scope, {
      externalCallId: row.id,
      source: row.source,
      sourceCallId: row.call_id,
      endpointId: row.endpoint_id,
      platform: row.platform,
      rootThreadId: row.root_thread_id,
      threadId: row.thread_id,
      turnId: row.turn_id,
      retentionDays: policy.retention_days,
    }, requestPayload);
    const endpointId = row.endpoint_id;
    await insertAudit(client, scope, "external_data.call.dispatch", "external_data_endpoint", endpointId, "allowed", {
      reservationId,
      archiveId,
    });
  });
}

export async function settleExternalDataCall(
  scope: ExternalDataCallScope,
  reservationId: string,
  input: {
    state: ExternalDataCallTerminalState;
    upstreamCode: number | null;
    upstreamMessage: string | null;
    resultBytes: number | null;
    responsePayload: Record<string, unknown> | null;
  },
): Promise<void> {
  await withEnterpriseTenantDatabaseContext(scope, async (client) => {
    const result = await client.query<{ id: string; endpoint_id: string }>(
      `
        UPDATE commerce_external_data_call
        SET state = $5,
            upstream_code = $6,
            upstream_message = $7,
            result_bytes = $8,
            vendor_cost_micros = CASE WHEN $5 = 'succeeded' THEN vendor_cost_micros ELSE NULL END,
            billable_amount_micros = CASE WHEN $5 = 'succeeded' THEN billable_amount_micros ELSE NULL END,
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4
          AND (
            state = 'dispatched'
            OR (
              state = $5
              AND upstream_code IS NOT DISTINCT FROM $6
              AND result_bytes IS NOT DISTINCT FROM $8
            )
          )
        RETURNING id, endpoint_id
      `,
      [
        reservationId,
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        input.state,
        input.upstreamCode,
        input.upstreamMessage?.slice(0, 500) ?? null,
        input.resultBytes,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ExternalDataGovernanceError("外部数据调用结算状态无效。", "EXTERNAL_DATA_SETTLEMENT_STALE", 409);
    }
    const archiveId = await recordExternalDataArchiveSettlement(client, scope, row.id, {
      state: input.state,
      upstreamCode: input.upstreamCode,
      responsePayload: input.responsePayload,
    });
    const endpointId = row.endpoint_id;
    await insertAudit(
      client,
      scope,
      "external_data.call.settle",
      "external_data_endpoint",
      endpointId,
      input.state === "succeeded" ? "succeeded" : "failed",
      {
        reservationId,
        state: input.state,
        upstreamCode: input.upstreamCode,
        resultBytes: input.resultBytes,
        archiveId,
      },
    );
  });
}

export async function cancelExternalDataCall(
  scope: ExternalDataCallScope,
  reservationId: string,
  reason: "user_denied" | "approval_required" | "upstream_unavailable",
): Promise<void> {
  await withEnterpriseTenantDatabaseContext(scope, async (client) => {
    const result = await client.query<{ endpoint_id: string }>(
      `
        UPDATE commerce_external_data_call
        SET state = 'cancelled',
            approval_state = CASE WHEN $5 = 'user_denied' THEN 'denied' ELSE approval_state END,
            completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4
          AND state = 'reserved'
        RETURNING endpoint_id
      `,
      [reservationId, scope.tenantId, scope.workspaceId, scope.userId, reason],
    );
    const endpointId = result.rows[0]?.endpoint_id;
    if (!endpointId) return;
    await insertAudit(client, scope, "external_data.call.cancel", "external_data_endpoint", endpointId, reason === "user_denied" ? "denied" : "failed", {
      reservationId,
      reason,
    });
  });
}

async function ensurePolicy(
  client: PoolClient,
  tenantId: string,
  workspaceId: string,
  lock = false,
): Promise<PolicyRow> {
  await client.query(
    `
      INSERT INTO commerce_external_data_policy (tenant_id, workspace_id)
      VALUES ($1, $2)
      ON CONFLICT (tenant_id, workspace_id, provider) DO NOTHING
    `,
    [tenantId, workspaceId],
  );
  const result = await client.query<PolicyRow>(
    `
      SELECT status, approval_mode, allowed_platforms, allowed_endpoint_ids,
             monthly_call_limit, monthly_spend_limit_micros,
             per_call_auto_approval_micros, per_turn_call_limit,
             currency, retention_days
      FROM commerce_external_data_policy
      WHERE tenant_id = $1 AND workspace_id = $2 AND provider = 'justoneapi'
      ${lock ? "FOR UPDATE" : ""}
    `,
    [tenantId, workspaceId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("External data policy is unavailable.");
  return row;
}

async function readEffectiveRate(
  client: PoolClient,
  scope: EnterpriseScope,
  endpointId: string,
): Promise<RateCardRow | null> {
  const override = await client.query<RateCardRow>(
    `
      SELECT id, endpoint_id, vendor_unit_cost_micros, customer_unit_price_micros,
             currency, effective_from
      FROM commerce_external_data_rate_card
      WHERE tenant_id = $1 AND workspace_id = $2 AND provider = 'justoneapi'
        AND endpoint_id = $3
        AND effective_from <= CURRENT_TIMESTAMP
        AND (effective_until IS NULL OR effective_until > CURRENT_TIMESTAMP)
      ORDER BY effective_from DESC
      LIMIT 1
    `,
    [scope.tenantId, scope.workspaceId, endpointId],
  );
  if (override.rows[0]) return override.rows[0];
  const provider = await client.query<RateCardRow>(
    `
      SELECT ('provider:' || endpoint_id) AS id, endpoint_id,
             vendor_unit_cost_micros,
             vendor_unit_cost_micros AS customer_unit_price_micros,
             currency, source_exported_at AS effective_from
      FROM commerce_external_provider_endpoint
      WHERE provider = 'justoneapi' AND endpoint_id = $1
        AND is_active = true AND permission_status = 'allowed'
      LIMIT 1
    `,
    [endpointId],
  );
  return provider.rows[0] ?? null;
}

async function assertProviderPolicySelection(
  client: PoolClient,
  platformIds: string[],
  endpointIds: string[],
): Promise<void> {
  const platforms = await client.query<{ platform_id: string }>(
    `SELECT DISTINCT platform_id
     FROM commerce_external_provider_endpoint
     WHERE provider = 'justoneapi' AND is_active = true
       AND permission_status = 'allowed' AND platform_id = ANY($1::text[])`,
    [platformIds],
  );
  if (platforms.rows.length !== new Set(platformIds).size) {
    throw new ExternalDataGovernanceError(
      "企业策略包含供应商目录中不存在或未开通的平台。",
      "EXTERNAL_DATA_PLATFORM_CATALOG_INVALID",
      400,
    );
  }
  if (!endpointIds.length) return;
  const endpoints = await client.query<{ endpoint_id: string; platform_id: string }>(
    `SELECT endpoint_id, platform_id
     FROM commerce_external_provider_endpoint
     WHERE provider = 'justoneapi' AND is_active = true
       AND permission_status = 'allowed' AND endpoint_id = ANY($1::text[])`,
    [endpointIds],
  );
  const allowedPlatforms = new Set(platformIds);
  if (
    endpoints.rows.length !== new Set(endpointIds).size ||
    endpoints.rows.some((endpoint) => !allowedPlatforms.has(endpoint.platform_id))
  ) {
    throw new ExternalDataGovernanceError(
      "接口白名单包含未开通接口，或接口不属于已允许的平台。",
      "EXTERNAL_DATA_ENDPOINT_CATALOG_INVALID",
      400,
    );
  }
}

async function readPeriodUsage(
  client: PoolClient,
  scope: EnterpriseScope,
  policy: PolicyRow,
): Promise<{ callsUsed: number; spendUsedMicros: number }> {
  const contract = await client.query<{ billing_anchor_day: number }>(
    `SELECT billing_anchor_day FROM commerce_enterprise_contract WHERE tenant_id = $1 LIMIT 1`,
    [scope.tenantId],
  );
  const periodStart = billingPeriodStart(contract.rows[0]?.billing_anchor_day ?? 1);
  const result = await client.query<{ calls_used: string; spend_used_micros: string }>(
    `
      SELECT
        count(*) FILTER (WHERE state IN ('dispatched', 'succeeded', 'business_failed', 'unknown'))::text AS calls_used,
        COALESCE(sum(billable_amount_micros) FILTER (WHERE state = 'succeeded'), 0)::text AS spend_used_micros
      FROM commerce_external_data_call
      WHERE tenant_id = $1 AND workspace_id = $2 AND created_at >= $3
    `,
    [scope.tenantId, scope.workspaceId, periodStart],
  );
  return {
    callsUsed: parseCount(result.rows[0]?.calls_used),
    spendUsedMicros: parseCount(result.rows[0]?.spend_used_micros),
  };
}

async function hasEffectivePermission(
  client: PoolClient,
  scope: EnterpriseScope,
  permission: string,
): Promise<boolean> {
  const result = await client.query<{ allowed: boolean; denied: boolean }>(
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
      )
      SELECT COALESCE(bool_or($4 = ANY(allowed_permissions)), false) AS allowed,
             COALESCE(bool_or($4 = ANY(denied_permissions)), false) AS denied
      FROM effective_roles
    `,
    [scope.tenantId, scope.workspaceId, scope.userId, permission],
  );
  return result.rows[0]?.allowed === true && result.rows[0]?.denied !== true;
}

function reservationView(
  row: {
    id: string;
    approval_state: ExternalDataReservation["approvalState"];
    pricing_status: ExternalDataReservation["pricingStatus"];
    currency: string;
    vendor_cost_micros: string | number | null;
    billable_amount_micros: string | number | null;
  },
  policy: PolicyRow,
  usage: { callsUsed: number; spendUsedMicros: number },
): ExternalDataReservation {
  return {
    reservationId: row.id,
    requiresApproval: row.approval_state === "pending",
    approvalState: row.approval_state,
    pricingStatus: row.pricing_status,
    currency: row.currency,
    vendorCostMicros: nullableNumber(row.vendor_cost_micros),
    billableAmountMicros: nullableNumber(row.billable_amount_micros),
    monthlyCallLimit: policy.monthly_call_limit,
    callsUsed: usage.callsUsed,
    monthlySpendLimitMicros: nullableNumber(policy.monthly_spend_limit_micros),
    spendUsedMicros: usage.spendUsedMicros,
  };
}

function validateCallIdentity(input: ReserveExternalDataCallInput): void {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.callId)) {
    throw new ExternalDataGovernanceError("外部调用标识无效。", "EXTERNAL_DATA_CALL_ID_INVALID", 400);
  }
  if (!/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/.test(input.endpointId)) {
    throw new ExternalDataGovernanceError("外部接口标识无效。", "EXTERNAL_DATA_ENDPOINT_INVALID", 400);
  }
  if (!/^[a-z0-9_]+$/.test(input.platform) || input.endpointId.split(".", 1)[0] !== input.platform) {
    throw new ExternalDataGovernanceError("外部平台与接口不匹配。", "EXTERNAL_DATA_PLATFORM_INVALID", 400);
  }
  if (!/^[a-f0-9]{64}$/.test(input.parameterHash)) {
    throw new ExternalDataGovernanceError("外部参数摘要无效。", "EXTERNAL_DATA_PARAMETER_HASH_INVALID", 400);
  }
  if (
    input.parameterKeys.length > 64 ||
    input.parameterKeys.some((key) => !/^[A-Za-z0-9_.-]{1,80}$/.test(key))
  ) {
    throw new ExternalDataGovernanceError("外部参数字段无效。", "EXTERNAL_DATA_PARAMETER_KEYS_INVALID", 400);
  }
  if (
    input.source === "codex_harness" &&
    (!input.threadId || !input.turnId || !/^[A-Za-z0-9_-]{8,128}$/.test(input.threadId) || !/^[A-Za-z0-9_-]{8,128}$/.test(input.turnId))
  ) {
    throw new ExternalDataGovernanceError("Harness 调用缺少任务绑定。", "EXTERNAL_DATA_HARNESS_BINDING_INVALID", 400);
  }
}

function toPolicyView(row: PolicyRow): ExternalDataPolicyView {
  return {
    status: row.status,
    approvalMode: row.approval_mode,
    allowedPlatforms: row.allowed_platforms,
    allowedEndpointIds: row.allowed_endpoint_ids,
    monthlyCallLimit: row.monthly_call_limit,
    monthlySpendLimitMicros: nullableNumber(row.monthly_spend_limit_micros),
    perCallAutoApprovalMicros: nullableNumber(row.per_call_auto_approval_micros),
    perTurnCallLimit: nullableNumber(row.per_turn_call_limit),
    currency: row.currency,
    retentionDays: nullableNumber(row.retention_days),
  };
}

function summarizeProviderPlatforms(
  endpoints: Array<{
    platform_id: string;
    platform_name: string;
    permission_status: "allowed" | "unavailable";
  }>,
): Array<{ id: string; name: string; endpointCount: number }> {
  const platforms = new Map<string, { id: string; name: string; endpointCount: number }>();
  for (const endpoint of endpoints) {
    if (endpoint.permission_status !== "allowed") continue;
    const existing = platforms.get(endpoint.platform_id);
    if (existing) existing.endpointCount += 1;
    else platforms.set(endpoint.platform_id, {
      id: endpoint.platform_id,
      name: endpoint.platform_name,
      endpointCount: 1,
    });
  }
  return [...platforms.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id));
}

function toRateCardView(row: RateCardRow): ExternalDataRateCardView {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    vendorUnitCostMicros: nullableNumber(row.vendor_unit_cost_micros),
    customerUnitPriceMicros: Number(row.customer_unit_price_micros),
    currency: row.currency,
    effectiveFrom: row.effective_from.toISOString(),
  };
}

async function insertAudit(
  client: PoolClient,
  scope: EnterpriseScope,
  action: string,
  targetType: string,
  targetId: string | null,
  outcome: "allowed" | "denied" | "succeeded" | "failed",
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `
      INSERT INTO commerce_enterprise_audit_event (
        tenant_id, workspace_id, actor_user_id, action,
        target_type, target_id, outcome, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      scope.tenantId,
      scope.workspaceId,
      scope.userId,
      action,
      targetType,
      targetId,
      outcome,
      JSON.stringify(metadata),
    ],
  );
}

async function recordExternalDataDenial(
  scope: EnterpriseScope,
  input: ReserveExternalDataCallInput,
  error: ExternalDataGovernanceError,
): Promise<void> {
  await withEnterpriseTenantDatabaseContext(scope, async (client) => {
    await insertAudit(
      client,
      scope,
      "external_data.call.reserve",
      "external_data_endpoint",
      input.endpointId,
      "denied",
      {
        code: error.code,
        source: input.source,
        platform: input.platform,
        callId: input.callId,
      },
    );
  });
}

function nullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseCount(value: string | number | null | undefined): number {
  return nullableNumber(value) ?? 0;
}
