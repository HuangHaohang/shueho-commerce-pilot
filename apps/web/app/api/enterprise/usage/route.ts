import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import {
  withEnterpriseDatabaseContext,
  withEnterpriseTenantDatabaseContext,
} from "@/lib/enterprise/database-context";
import { billingPeriodStart } from "@/lib/enterprise/billing-period";

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "usage.read");
  if (!access.ok) return access.response;
  const context = access.context;
  const periodStart = billingPeriodStart(context.contract.billingAnchorDay);
  const workspaceRow = await withEnterpriseDatabaseContext(context, async (client) => {
    return readUsageSummary(client, context.tenantId, periodStart, context.workspaceId);
  });
  const canReadTenantUsage = context.tenantPermissions.has("usage.read");
  const tenantRow = canReadTenantUsage
    ? await withEnterpriseTenantDatabaseContext(context, async (client) => {
        return readUsageSummary(client, context.tenantId, periodStart);
      })
    : null;
  const workspaceSummary = normalizeUsageSummary(workspaceRow);
  const tenantSummary = tenantRow ? normalizeUsageSummary(tenantRow) : null;
  const primary = tenantSummary ?? workspaceSummary;
  return NextResponse.json(
    {
      periodStart: periodStart.toISOString(),
      workspaceId: context.workspaceId,
      scope: tenantSummary ? "tenant" : "workspace",
      ...primary,
      workspaceSummary,
      ...(tenantSummary ? { tenantSummary } : {}),
      contract: {
        monthlyTotalTokenLimit: context.contract.monthlyTotalTokenLimit,
        monthlyModelRequestLimit: context.contract.monthlyModelRequestLimit,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

type UsageSummaryRow = {
  model_requests: string;
  missing_usage_events: string;
  total_tokens: string;
  input_tokens: string;
  cached_input_tokens: string;
  cache_write_input_tokens: string;
  output_tokens: string;
  reasoning_output_tokens: string;
};

async function readUsageSummary(
  client: import("pg").PoolClient,
  tenantId: string,
  periodStart: Date,
  workspaceId?: string,
): Promise<UsageSummaryRow | undefined> {
  const result = await client.query<UsageSummaryRow>(
    `
      SELECT
        count(*)::text AS model_requests,
        count(*) FILTER (WHERE usage_status = 'missing')::text AS missing_usage_events,
        COALESCE(sum(total_tokens), 0)::text AS total_tokens,
        COALESCE(sum(input_tokens), 0)::text AS input_tokens,
        COALESCE(sum(cached_input_tokens), 0)::text AS cached_input_tokens,
        COALESCE(sum(cache_write_input_tokens), 0)::text AS cache_write_input_tokens,
        COALESCE(sum(output_tokens), 0)::text AS output_tokens,
        COALESCE(sum(reasoning_output_tokens), 0)::text AS reasoning_output_tokens
      FROM commerce_agent_usage_event
      WHERE tenant_id = $1
        AND ($2::uuid IS NULL OR workspace_id = $2::uuid)
        AND occurred_at >= $3
    `,
    [tenantId, workspaceId ?? null, periodStart],
  );
  return result.rows[0];
}

function normalizeUsageSummary(summary: UsageSummaryRow | undefined) {
  const inputTokens = numeric(summary?.input_tokens);
  const cachedInputTokens = numeric(summary?.cached_input_tokens);
  const cacheWriteInputTokens = numeric(summary?.cache_write_input_tokens);
  return {
    modelRequests: numeric(summary?.model_requests),
    missingUsageEvents: numeric(summary?.missing_usage_events),
    totalTokens: numeric(summary?.total_tokens),
    inputTokens,
    ordinaryInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheWriteInputTokens),
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens: numeric(summary?.output_tokens),
    reasoningOutputTokens: numeric(summary?.reasoning_output_tokens),
    cacheHitRatio: inputTokens > 0 ? cachedInputTokens / inputTokens : 0,
  };
}

function numeric(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}
