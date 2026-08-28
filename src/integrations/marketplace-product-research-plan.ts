import type { ExternalDataServiceMcpClient } from "./external-data-service-mcp-client.js";
import {
  MarketplaceProductResearchPreflightError,
  parseMarketplaceProductResearchPreflightPayload,
  type MarketplaceProductResearchPreflight,
} from "./marketplace-product-research-preflight.js";

export type MarketplaceProductResearchPlanInput = {
  platform: string;
  keyword: string;
  localized_keywords: string[];
  market: string | null;
  tmall_only: boolean;
  min_price_yuan: number | null;
  max_price_yuan: number | null;
  requested_metrics: Array<"price_band" | "sales_level" | "brand_competition" | "property_distribution">;
  max_results: number;
  detail_sample_size: number | null;
};

export type MarketplaceProductResearchPlanReceipt = MarketplaceProductResearchPreflight & {
  planId: string;
  requestText: string;
  expiresAt: string;
  marketContext: Record<string, unknown>;
  detailSampleSize: number;
  estimatedProviderCalls: number;
};

export type MarketplaceProductResearchStepInstance = {
  stepInstanceId: string;
  stepInstanceKey: string;
  targetId: string | null;
  targetOrdinal: number | null;
  stepId: string;
  stepOrder: number;
  instanceOrder: number;
  role: "discovery" | "detail" | "price" | "reviews" | "sku";
  endpointId: string;
  bindings: Record<string, string | number>;
};

export type ExecutableMarketplaceProductResearchPlan = MarketplaceProductResearchPlanReceipt & {
  executionId: string;
  stepInstances: MarketplaceProductResearchStepInstance[];
};

export async function createMarketplaceProductResearchPlan(
  service: Pick<ExternalDataServiceMcpClient, "planMarketplaceProductResearch">,
  input: MarketplaceProductResearchPlanInput,
  context: Record<string, unknown>,
  authorization: { allowedPlatforms: string[]; allowedEndpointIds: string[] },
): Promise<MarketplaceProductResearchPlanReceipt> {
  const result = await service.planMarketplaceProductResearch({
    ...input,
    allowed_catalog_platforms: authorization.allowedPlatforms,
    allowed_endpoint_ids: authorization.allowedEndpointIds,
    _commerce_context: context,
  });
  return readPlanReceipt(result.payload);
}

export async function executeMarketplaceProductResearchPlan(
  service: Pick<ExternalDataServiceMcpClient, "executeMarketplaceProductResearchPlan">,
  planId: string,
  context: Record<string, unknown>,
  authorization: { allowedPlatforms: string[]; allowedEndpointIds: string[] },
): Promise<ExecutableMarketplaceProductResearchPlan> {
  const result = await service.executeMarketplaceProductResearchPlan({
    plan_id: planId,
    allowed_catalog_platforms: authorization.allowedPlatforms,
    allowed_endpoint_ids: authorization.allowedEndpointIds,
    _commerce_context: context,
  });
  const receipt = readPlanReceipt(result.payload);
  const executionId = typeof result.payload.workflow_execution_id === "string"
    ? result.payload.workflow_execution_id
    : "";
  if (!isUuid(executionId) || !Array.isArray(result.payload.step_instances)) {
    throw new MarketplaceProductResearchPreflightError(
      "商品研究计划没有返回有效执行实例。",
      "INVALID_MARKETPLACE_PLAN_EXECUTION",
    );
  }
  const stepInstances = parseMarketplaceProductResearchStepInstances(result.payload.step_instances);
  if (!stepInstances.length) {
    throw new MarketplaceProductResearchPreflightError(
      "商品研究计划没有可执行的搜索步骤。",
      "INVALID_MARKETPLACE_STEP_INSTANCES",
    );
  }
  return { ...receipt, executionId, stepInstances };
}

export function parseMarketplaceProductResearchStepInstances(
  value: unknown,
): MarketplaceProductResearchStepInstance[] {
  if (!Array.isArray(value)) throw invalidStepInstance();
  return value.map(readStepInstance);
}

function readPlanReceipt(payload: Record<string, unknown>): MarketplaceProductResearchPlanReceipt {
  if (payload.success !== true) {
    throw new MarketplaceProductResearchPreflightError(
      typeof payload.message === "string" ? payload.message : "商品研究计划不可用。",
      typeof payload.code === "string" ? payload.code : "MARKETPLACE_RESEARCH_PLAN_FAILED",
      isRecord(payload.details) ? payload.details : {},
    );
  }
  const preflight = parseMarketplaceProductResearchPreflightPayload({
    ...payload,
    business_tool: "research_marketplace_products",
  });
  const planId = typeof payload.plan_id === "string" ? payload.plan_id : "";
  const requestText = typeof payload.request_text === "string" ? payload.request_text : "";
  const expiresAt = typeof payload.expires_at === "string" ? payload.expires_at : "";
  const detailSampleSize = numberValue(payload.detail_sample_size);
  const estimatedProviderCalls = numberValue(payload.estimated_provider_calls);
  if (
    !isUuid(planId) || !requestText || requestText.length > 50_000 ||
    !Number.isFinite(Date.parse(expiresAt)) || !isRecord(payload.market_context) ||
    !Number.isInteger(detailSampleSize) || detailSampleSize < 1 || detailSampleSize > 10 ||
    !Number.isInteger(estimatedProviderCalls) || estimatedProviderCalls < 1 || estimatedProviderCalls > 100
  ) {
    throw new MarketplaceProductResearchPreflightError(
      "商品研究计划收据无效。",
      "INVALID_MARKETPLACE_PLAN_RECEIPT",
    );
  }
  return {
    ...preflight,
    planId,
    requestText,
    expiresAt,
    marketContext: payload.market_context,
    detailSampleSize,
    estimatedProviderCalls,
  };
}

function readStepInstance(value: unknown): MarketplaceProductResearchStepInstance {
  if (!isRecord(value)) throw invalidStepInstance();
  const role = value.role;
  if (
    !isUuid(value.stepInstanceId) || typeof value.stepInstanceKey !== "string" ||
    (value.targetId !== null && !isUuid(value.targetId)) ||
    (value.targetOrdinal !== null && (!Number.isInteger(value.targetOrdinal) || Number(value.targetOrdinal) < 0)) ||
    typeof value.stepId !== "string" || !Number.isInteger(value.stepOrder) ||
    !Number.isInteger(value.instanceOrder) ||
    (role !== "discovery" && role !== "detail" && role !== "price" && role !== "reviews" && role !== "sku") ||
    typeof value.endpointId !== "string" || !isRecord(value.bindings)
  ) throw invalidStepInstance();
  const bindings = Object.fromEntries(Object.entries(value.bindings).filter((entry): entry is [string, string | number] =>
    typeof entry[1] === "string" || typeof entry[1] === "number"));
  return {
    stepInstanceId: value.stepInstanceId,
    stepInstanceKey: value.stepInstanceKey,
    targetId: value.targetId,
    targetOrdinal: value.targetOrdinal,
    stepId: value.stepId,
    stepOrder: value.stepOrder,
    instanceOrder: value.instanceOrder,
    role,
    endpointId: value.endpointId,
    bindings,
  } as MarketplaceProductResearchStepInstance;
}

function invalidStepInstance(): MarketplaceProductResearchPreflightError {
  return new MarketplaceProductResearchPreflightError(
    "商品研究步骤实例无效。",
    "INVALID_MARKETPLACE_STEP_INSTANCE",
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
