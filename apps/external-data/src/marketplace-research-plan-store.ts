import { withScope } from "./database.js";
import { config } from "./config.js";
import {
  normalizeFirstPartySubject,
  planMarketplaceProductResearch,
  toStoredFirstPartySubject,
  type MarketplaceResearchPlan,
  type MarketplaceResearchRequest,
} from "./marketplace-research-planner.js";
import type { ExternalDataScope, FirstPartyResearchSubject, JsonObject } from "./types.js";

type StoredPlanRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  source: ExternalDataScope["source"];
  source_call_id: string;
  root_thread_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  workflow_id: string;
  workflow_version: string;
  workflow_definition_sha256: string;
  source_catalog_import_id: string;
  market_profile_id: string | null;
  market_profile_sha256: string | null;
  plan_key: string;
  request_text: string;
  requested_input: JsonObject;
  normalized_input: JsonObject;
  market_context: JsonObject;
  business_intent: JsonObject;
  plan_coverage: JsonObject;
  step_templates: JsonObject[];
  detail_sample_size: number;
  estimated_provider_calls: number;
  state: string;
  expires_at: Date;
  workflow_execution_id: string | null;
};

export type PersistedMarketplaceResearchPlan = {
  planId: string;
  planKey: string;
  state: string;
  expiresAt: string;
  detailSampleSize: number;
  estimatedProviderCalls: number;
  marketContext: JsonObject;
};

export async function persistMarketplaceResearchPlan(
  scope: ExternalDataScope,
  requestedInput: MarketplaceResearchRequest,
  plan: MarketplaceResearchPlan,
): Promise<PersistedMarketplaceResearchPlan> {
  if (scope.source === "archive_import") {
    throw new MarketplaceResearchPlanError("Archive imports cannot create executable plans.", "PLAN_SOURCE_INVALID");
  }
  assertSameFirstPartySubject(
    plan.firstPartySubject,
    scope.firstPartySubject ?? null,
    "PLAN_SUBJECT_MISMATCH",
  );
  const expiresAt = new Date(Date.now() + config.marketplacePlanTtlMs);
  const stepTemplates = plan.steps.map((step) => ({
    step_id: step.stepId,
    step_order: step.stepOrder,
    role: step.role,
    endpoint_id: step.endpoint.endpointId,
    schema_version: step.endpoint.schemaVersion,
    parameter_template: step.parameterTemplate,
    dynamic_parameter_bindings: step.dynamicParameterBindings,
    output_bindings: step.outputBindings,
    required: step.required,
  }));
  return withScope(scope, async (client) => {
    const inserted = await client.query<StoredPlanRow>(`
      INSERT INTO marketplace_research_plan (
        tenant_id,workspace_id,user_id,source,source_call_id,root_thread_id,thread_id,turn_id,
        workflow_id,workflow_version,workflow_definition_sha256,source_catalog_import_id,
        market_profile_id,market_profile_sha256,plan_key,request_text,requested_input,
        normalized_input,market_context,business_intent,plan_coverage,step_templates,
        detail_sample_size,estimated_provider_calls,state,expires_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,
        $18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23,$24,'ready',$25
      )
      ON CONFLICT (tenant_id,source,source_call_id) DO NOTHING
      RETURNING *
    `, [
      scope.tenantId,scope.workspaceId,scope.userId,scope.source,scope.sourceCallId,
      scope.rootThreadId ?? null,scope.threadId ?? null,scope.turnId ?? null,
      plan.workflow.workflowId,plan.workflow.workflowVersion,plan.workflow.definitionSha256,
      plan.workflow.sourceCatalogImportId,plan.marketContext?.profileId ?? null,
      plan.marketContext?.profileRevision ?? null,plan.planKey,scope.requestText,
      JSON.stringify(requestedInput),JSON.stringify(plan.businessInput),
      JSON.stringify(plan.marketContext ?? {}),JSON.stringify(plan.businessIntent),
      JSON.stringify(plan.coverage),JSON.stringify(stepTemplates),
      plan.detailSampleSize,plan.estimatedProviderCalls,expiresAt,
    ]);
    const existing = inserted.rows[0] ?? (await client.query<StoredPlanRow>(`
      SELECT * FROM marketplace_research_plan
      WHERE tenant_id=$1 AND source=$2 AND source_call_id=$3 LIMIT 1
    `, [scope.tenantId,scope.source,scope.sourceCallId])).rows[0];
    if (
      !existing || existing.workspace_id !== scope.workspaceId || existing.user_id !== scope.userId ||
      existing.plan_key !== plan.planKey || existing.request_text !== scope.requestText
    ) {
      throw new MarketplaceResearchPlanError(
        "Marketplace plan source_call_id is already bound to another request.",
        "PLAN_IDEMPOTENCY_CONFLICT",
      );
    }
    return planView(existing);
  });
}

export async function loadExecutableMarketplaceResearchPlan(
  scope: ExternalDataScope,
  planId: string,
  constraints: { allowedCatalogPlatforms?: string[]; allowedEndpointIds?: string[] } = {},
): Promise<{ stored: StoredPlanRow; plan: MarketplaceResearchPlan; request: MarketplaceResearchRequest }> {
  const stored = await withScope(scope, async (client) => {
    const result = await client.query<StoredPlanRow>(`
      SELECT * FROM marketplace_research_plan
      WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 LIMIT 1
    `, [planId,scope.tenantId,scope.workspaceId]);
    return result.rows[0] ?? null;
  });
  if (
    !stored || stored.user_id !== scope.userId || stored.source !== scope.source ||
    stored.thread_id !== (scope.threadId ?? null) || stored.turn_id !== (scope.turnId ?? null) ||
    stored.root_thread_id !== (scope.rootThreadId ?? null)
  ) {
    throw new MarketplaceResearchPlanError("Marketplace research plan was not found.", "PLAN_NOT_FOUND");
  }
  const storedSubject = readStoredFirstPartySubject(stored.business_intent.first_party_subject);
  assertSameFirstPartySubject(
    storedSubject,
    scope.firstPartySubject ?? null,
    "PLAN_SUBJECT_MISMATCH",
  );
  let replayOfSameExecution = false;
  if (stored.state === "executing" && stored.workflow_execution_id) {
    replayOfSameExecution = await withScope(scope,async (client) => {
      const execution = await client.query<{ source: string; source_call_id: string; user_id: string }>(`
        SELECT source,source_call_id,user_id FROM research_workflow_execution
        WHERE id=$1 AND research_plan_id=$2 LIMIT 1
      `,[stored.workflow_execution_id,stored.id]);
      const row = execution.rows[0];
      return Boolean(row && row.source === scope.source && row.source_call_id === scope.sourceCallId && row.user_id === scope.userId);
    });
  }
  if (stored.state !== "ready" && !replayOfSameExecution) {
    throw new MarketplaceResearchPlanError(`Marketplace research plan is already ${stored.state}.`,"PLAN_NOT_READY");
  }
  if (stored.state === "ready" && stored.expires_at.getTime() <= Date.now()) {
    await withScope(scope, async (client) => client.query(`
      UPDATE marketplace_research_plan SET state='expired',updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND state='ready'
    `, [planId]));
    throw new MarketplaceResearchPlanError("Marketplace research plan expired before execution.", "PLAN_EXPIRED");
  }
  const request = readStoredRequest(stored.requested_input);
  const plan = await planMarketplaceProductResearch(request, constraints, storedSubject);
  if (
    plan.planKey !== stored.plan_key || plan.workflow.workflowId !== stored.workflow_id ||
    plan.workflow.workflowVersion !== stored.workflow_version ||
    plan.workflow.definitionSha256 !== stored.workflow_definition_sha256 ||
    plan.workflow.sourceCatalogImportId !== stored.source_catalog_import_id ||
    (plan.marketContext?.profileRevision ?? null) !== stored.market_profile_sha256
  ) {
    throw new MarketplaceResearchPlanError(
      "Marketplace catalog, market profile or workflow changed after planning; create a new free plan.",
      "PLAN_STALE",
    );
  }
  return { stored, plan, request };
}

export async function markMarketplaceResearchPlanExecuting(
  scope: Pick<ExternalDataScope, "tenantId" | "workspaceId">,
  planId: string,
  workflowExecutionId: string,
): Promise<void> {
  await withScope(scope, async (client) => {
    const result = await client.query<{ id: string }>(`
      UPDATE marketplace_research_plan
      SET state='executing',workflow_execution_id=$4,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND state='ready'
      RETURNING id
    `, [planId,scope.tenantId,scope.workspaceId,workflowExecutionId]);
    if (!result.rows[0]) throw new MarketplaceResearchPlanError("Marketplace plan is no longer executable.", "PLAN_NOT_READY");
  });
}

export async function settleMarketplaceResearchPlan(
  scope: Pick<ExternalDataScope, "tenantId" | "workspaceId">,
  planId: string | null,
  state: "completed" | "partial" | "failed" | "cancelled",
): Promise<void> {
  if (!planId) return;
  await withScope(scope, async (client) => client.query(`
    UPDATE marketplace_research_plan SET state=$4,updated_at=CURRENT_TIMESTAMP
    WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND state='executing'
  `, [planId,scope.tenantId,scope.workspaceId,state]));
}

function readStoredRequest(value: JsonObject): MarketplaceResearchRequest {
  return {
    platform: stringValue(value.platform),
    keyword: stringValue(value.keyword),
    localizedKeyword: nullableString(value.localizedKeyword),
    localizedKeywords: stringArray(value.localizedKeywords),
    market: nullableString(value.market),
    tmallOnly: value.tmallOnly === true,
    minPriceYuan: nullableNumber(value.minPriceYuan),
    maxPriceYuan: nullableNumber(value.maxPriceYuan),
    requestedMetrics: stringArray(value.requestedMetrics) as MarketplaceResearchRequest["requestedMetrics"],
    maxResults: numberValue(value.maxResults),
    detailSampleSize: nullableNumber(value.detailSampleSize),
  };
}

function planView(row: StoredPlanRow): PersistedMarketplaceResearchPlan {
  return {
    planId: row.id,
    planKey: row.plan_key,
    state: row.state,
    expiresAt: row.expires_at.toISOString(),
    detailSampleSize: row.detail_sample_size,
    estimatedProviderCalls: row.estimated_provider_calls,
    marketContext: row.market_context,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : stringValue(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : numberValue(value);
}

function readStoredFirstPartySubject(value: unknown): FirstPartyResearchSubject | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !Array.isArray(value.products)) {
    throw new MarketplaceResearchPlanError(
      "Stored marketplace research subject is invalid.",
      "PLAN_SUBJECT_INVALID",
    );
  }
  try {
    return normalizeFirstPartySubject({
      version: value.version as 1,
      subjectRef: stringValue(value.subject_ref),
      snapshotSha256: stringValue(value.snapshot_sha256),
      productCount: numberValue(value.product_count),
      products: value.products.map((product) => {
        if (!isRecord(product)) return { productId: "", productRevisionId: "" };
        return {
          productId: stringValue(product.product_id),
          productRevisionId: stringValue(product.product_revision_id),
        };
      }),
    });
  } catch {
    throw new MarketplaceResearchPlanError(
      "Stored marketplace research subject is invalid.",
      "PLAN_SUBJECT_INVALID",
    );
  }
}

function assertSameFirstPartySubject(
  expected: FirstPartyResearchSubject | null,
  actual: FirstPartyResearchSubject | null,
  code: string,
): void {
  const expectedStored = toStoredFirstPartySubject(expected);
  let actualStored: JsonObject | null;
  try {
    actualStored = toStoredFirstPartySubject(normalizeFirstPartySubject(actual));
  } catch {
    throw new MarketplaceResearchPlanError(
      "Marketplace research plan received an invalid first-party product snapshot.",
      code,
    );
  }
  if (JSON.stringify(expectedStored) !== JSON.stringify(actualStored)) {
    throw new MarketplaceResearchPlanError(
      "Marketplace research plan is bound to a different first-party product snapshot.",
      code,
    );
  }
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export class MarketplaceResearchPlanError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "MarketplaceResearchPlanError";
  }
}
