import { sha256Json } from "./canonical.js";
import type {
  ProviderBusinessWorkflow,
  WorkflowInputBinding,
  WorkflowOutputBinding,
} from "./business-workflows.js";
import { validateEndpointParams } from "./endpoint-registry.js";
import type { JsonObject, ProviderEndpoint } from "./types.js";
import { listMarketplaceBusinessWorkflows } from "./workflow-registry.js";

export type MarketplaceResearchMetric = "price_band" | "sales_level" | "brand_competition" | "property_distribution";

export type MarketplaceResearchRequest = {
  platform: string;
  keyword: string;
  localizedKeyword: string | null;
  market: string | null;
  tmallOnly: boolean;
  minPriceYuan: number | null;
  maxPriceYuan: number | null;
  requestedMetrics: MarketplaceResearchMetric[];
  maxResults: number;
};

export type MarketplaceResearchConstraints = {
  allowedCatalogPlatforms?: string[];
  allowedEndpointIds?: string[];
};

export type MarketplaceResearchStepPlan = {
  stepId: string;
  stepOrder: number;
  role: "discovery" | "detail" | "price" | "reviews" | "sku";
  endpoint: ProviderEndpoint;
  parameterTemplate: JsonObject;
  dynamicParameterBindings: Record<string, string>;
  outputBindings: WorkflowOutputBinding[];
  required: boolean;
};

export type MarketplaceResearchPlan = {
  planKey: string;
  workflow: ProviderBusinessWorkflow;
  businessInput: JsonObject;
  steps: MarketplaceResearchStepPlan[];
  businessIntent: JsonObject;
  coverage: JsonObject;
};

export class MarketplaceResearchPlanningError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_RESEARCH_REQUEST"
      | "CAPABILITY_UNAVAILABLE"
      | "MARKET_SELECTION_REQUIRED"
      | "MARKET_UNSUPPORTED"
      | "LOCALIZED_KEYWORD_REQUIRED",
    readonly details: JsonObject = {},
  ) {
    super(message);
    this.name = "MarketplaceResearchPlanningError";
  }
}

export async function planMarketplaceProductResearch(
  input: MarketplaceResearchRequest,
  constraints: MarketplaceResearchConstraints = {},
): Promise<MarketplaceResearchPlan> {
  const workflows = (await listMarketplaceBusinessWorkflows()).filter((workflow) =>
    (!constraints.allowedCatalogPlatforms?.length || constraints.allowedCatalogPlatforms.includes(workflow.platformId)) &&
    (!constraints.allowedEndpointIds?.length || workflow.steps.every((step) => constraints.allowedEndpointIds!.includes(step.endpoint.endpointId)))
  );
  return selectMarketplaceProductResearchPlan(workflows, input);
}

export function selectMarketplaceProductResearchPlan(
  workflows: ProviderBusinessWorkflow[],
  input: MarketplaceResearchRequest,
): MarketplaceResearchPlan {
  const request = normalizeRequest(input);
  const platformId = request.platform.toLowerCase();
  const workflow = workflows
    .filter((candidate) => candidate.platformId === platformId && candidate.businessTool === "research_marketplace_products")
    .sort((left, right) => left.workflowId.localeCompare(right.workflowId))[0];
  if (!workflow) {
    throw new MarketplaceResearchPlanningError(
      `当前已授权数据目录中没有支持 ${request.platform} 关键词商品详情研究的完整工作流。`,
      "CAPABILITY_UNAVAILABLE",
      { platform: request.platform, providerDispatched: false },
    );
  }
  validateMarketSelection(workflow, request);
  validateLocalizedKeyword(workflow, request);
  assertRequestedFiltersAreBound(workflow, request);
  const businessInput: JsonObject = {
    platform: request.platform,
    keyword: request.keyword,
    localized_keyword: request.localizedKeyword,
    effective_keyword: request.localizedKeyword ?? request.keyword,
    market: request.market,
    tmall_only: request.tmallOnly,
    min_price_yuan: request.minPriceYuan,
    max_price_yuan: request.maxPriceYuan,
    requested_metrics: request.requestedMetrics,
    max_results: request.maxResults,
  };
  const steps = workflow.steps.map((step) => buildStepPlan(step, businessInput));
  const businessIntent: JsonObject = {
    kind: "marketplace_product_research",
    platform: request.platform,
    target_product: request.keyword,
    objective: "product_details_by_keyword",
    requested_metrics: request.requestedMetrics,
    time_range: null,
    window_enforcement: null,
    requested_top_n: request.maxResults,
    workflow_id: workflow.workflowId,
    workflow_version: workflow.workflowVersion,
    localized_keyword: request.localizedKeyword,
  };
  const coverage: JsonObject = {
    requested_platform: request.platform,
    requested_keyword: request.keyword,
    localized_keyword: request.localizedKeyword,
    requested_market: request.market,
    requested_metrics: request.requestedMetrics,
    tmall_only: request.tmallOnly,
    price_filter: { minimum_yuan: request.minPriceYuan, maximum_yuan: request.maxPriceYuan },
    provider_calls_planned: steps.length,
    workflow_roles: steps.map((step) => step.role),
    detailed_products_planned: 1,
  };
  const planKey = sha256Json({
    contractVersion: 2,
    businessTool: "research_marketplace_products",
    workflowId: workflow.workflowId,
    workflowVersion: workflow.workflowVersion,
    workflowDefinitionSha256: workflow.definitionSha256,
    businessInput,
    steps: steps.map((step) => ({
      stepId: step.stepId,
      endpointId: step.endpoint.endpointId,
      schemaVersion: step.endpoint.schemaVersion,
      parameterTemplate: step.parameterTemplate,
      dynamicParameterBindings: step.dynamicParameterBindings,
      outputBindings: step.outputBindings,
    })),
    businessIntent,
  });
  return { planKey, workflow, businessInput, steps, businessIntent, coverage };
}

export function materializeMarketplaceStepParams(
  step: MarketplaceResearchStepPlan,
  resolvedBindings: Record<string, string | number>,
): JsonObject {
  const params = structuredClone(step.parameterTemplate);
  for (const [parameter, bindingName] of Object.entries(step.dynamicParameterBindings)) {
    const value = resolvedBindings[bindingName];
    if (value === undefined) {
      throw new MarketplaceResearchPlanningError(
        `商品研究工作流缺少 ${bindingName}，不会继续发送 ${step.role} 调用。`,
        "CAPABILITY_UNAVAILABLE",
        { stepId: step.stepId, bindingName, providerDispatched: false },
      );
    }
    params[parameter] = value;
  }
  return validateEndpointParams(step.endpoint, params);
}

function buildStepPlan(
  step: ProviderBusinessWorkflow["steps"][number],
  businessInput: JsonObject,
): MarketplaceResearchStepPlan {
  const params: JsonObject = {};
  const dynamicParameterBindings: Record<string, string> = {};
  const properties = schemaProperties(step.endpoint.requestSchema);
  for (const [parameter, binding] of Object.entries(step.inputBindings)) {
    if (binding.source === "literal") {
      params[parameter] = binding.value;
      continue;
    }
    if (binding.source === "business_input") {
      const value = businessInput[binding.key];
      if (value === null || value === undefined || value === "") {
        if (binding.omit_if_null) continue;
        throw new MarketplaceResearchPlanningError(
          `平台 ${String(businessInput.platform)} 的工作流需要业务参数 ${binding.key}。`,
          "INVALID_RESEARCH_REQUEST",
          { missingBusinessInput: binding.key, providerDispatched: false },
        );
      }
      params[parameter] = value;
      continue;
    }
    dynamicParameterBindings[parameter] = binding.key;
    params[parameter] = placeholderForSchema(record(properties[parameter]), binding);
  }
  return {
    stepId: step.stepId,
    stepOrder: step.stepOrder,
    role: step.role,
    endpoint: step.endpoint,
    parameterTemplate: validateEndpointParams(step.endpoint, params),
    dynamicParameterBindings,
    outputBindings: step.outputBindings,
    required: step.required,
  };
}

function assertRequestedFiltersAreBound(
  workflow: ProviderBusinessWorkflow,
  request: MarketplaceResearchRequest,
): void {
  const businessKeys = new Set(workflow.steps.flatMap((step) => Object.values(step.inputBindings)
    .filter((binding): binding is Extract<WorkflowInputBinding, { source: "business_input" }> => binding.source === "business_input")
    .map((binding) => binding.key)));
  const unsupported = [
    request.tmallOnly && !businessKeys.has("tmall_only") ? "tmall_only" : null,
    request.minPriceYuan !== null && !businessKeys.has("min_price_yuan") ? "min_price_yuan" : null,
    request.maxPriceYuan !== null && !businessKeys.has("max_price_yuan") ? "max_price_yuan" : null,
    request.market !== null && !businessKeys.has("market") ? "market" : null,
  ].filter((value): value is string => Boolean(value));
  if (unsupported.length) {
    throw new MarketplaceResearchPlanningError(
      `平台 ${request.platform} 的当前工作流不支持这些筛选条件：${unsupported.join("、")}。`,
      "CAPABILITY_UNAVAILABLE",
      { unsupportedFilters: unsupported, providerDispatched: false },
    );
  }
}

function validateMarketSelection(
  workflow: ProviderBusinessWorkflow,
  request: MarketplaceResearchRequest,
): void {
  const hasMarketBinding = workflow.steps.some((step) => Object.values(step.inputBindings).some((binding) =>
    binding.source === "business_input" && binding.key === "market"));
  if (!hasMarketBinding) return;
  const choices = workflow.marketOptions.map((option) => ({ code: option.code, label: option.displayName }));
  if (!choices.length) {
    throw new MarketplaceResearchPlanningError(
      `${workflow.displayName}的市场站点主数据不可用，已停止调用。`,
      "CAPABILITY_UNAVAILABLE",
      { platform: request.platform, providerDispatched: false },
    );
  }
  const supported = choices.map((choice) => choice.code);
  const choiceText = choices.map((choice) => `${choice.label}（${choice.code}）`).join("、");
  if (request.market === null) {
    throw new MarketplaceResearchPlanningError(
      `${workflow.displayName}需要先选择市场站点。当前支持：${choiceText}。`,
      "MARKET_SELECTION_REQUIRED",
      { platform: request.platform, supportedMarkets: choices, providerDispatched: false },
    );
  }
  if (!supported.includes(request.market)) {
    throw new MarketplaceResearchPlanningError(
      `${workflow.displayName}当前不支持站点 ${request.market}。当前支持：${choiceText}。`,
      "MARKET_UNSUPPORTED",
      { platform: request.platform, requestedMarket: request.market, supportedMarkets: choices, providerDispatched: false },
    );
  }
}

function validateLocalizedKeyword(
  workflow: ProviderBusinessWorkflow,
  request: MarketplaceResearchRequest,
): void {
  if (!workflow.marketOptions.length || request.localizedKeyword) return;
  throw new MarketplaceResearchPlanningError(
    `${workflow.displayName}需要一个由 Agent 生成的本地市场检索词，不能直接用未本地化的关键词发起付费调用。`,
    "LOCALIZED_KEYWORD_REQUIRED",
    { platform: request.platform, market: request.market, providerDispatched: false },
  );
}

function normalizeRequest(input: MarketplaceResearchRequest): MarketplaceResearchRequest {
  const platform = input.platform.normalize("NFKC").trim().toUpperCase();
  const keyword = input.keyword.normalize("NFKC").trim().replace(/\s+/g, " ");
  const localizedKeyword = input.localizedKeyword === null
    ? null
    : input.localizedKeyword.normalize("NFKC").trim().replace(/\s+/g, " ");
  const market = input.market === null ? null : input.market.normalize("NFKC").trim().toUpperCase();
  if (
    !/^[A-Z0-9_]{2,64}$/.test(platform) || !keyword || keyword.length > 500 ||
    (localizedKeyword !== null && (!localizedKeyword || localizedKeyword.length > 500)) ||
    (market !== null && !/^[A-Z0-9_-]{2,32}$/.test(market))
  ) {
    throw new MarketplaceResearchPlanningError("商品研究的平台、市场站点或关键词无效。", "INVALID_RESEARCH_REQUEST");
  }
  if (
    (input.minPriceYuan !== null && (!Number.isFinite(input.minPriceYuan) || input.minPriceYuan < 0)) ||
    (input.maxPriceYuan !== null && (!Number.isFinite(input.maxPriceYuan) || input.maxPriceYuan < 0)) ||
    (input.minPriceYuan !== null && input.maxPriceYuan !== null && input.minPriceYuan > input.maxPriceYuan)
  ) {
    throw new MarketplaceResearchPlanningError("商品研究价格范围无效。", "INVALID_RESEARCH_REQUEST");
  }
  const requestedMetrics = [...new Set(input.requestedMetrics)].sort() as MarketplaceResearchMetric[];
  if (requestedMetrics.some((metric) => !["price_band", "sales_level", "brand_competition", "property_distribution"].includes(metric))) {
    throw new MarketplaceResearchPlanningError("商品研究指标无效。", "INVALID_RESEARCH_REQUEST");
  }
  if (!requestedMetrics.length || !Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 100) {
    throw new MarketplaceResearchPlanningError("商品研究必须包含指标，且结果上限必须为 1 到 100。", "INVALID_RESEARCH_REQUEST");
  }
  return { ...input, platform, keyword, localizedKeyword, market, requestedMetrics };
}

function placeholderForSchema(schema: JsonObject, binding: Extract<WorkflowInputBinding, { source: "resolved_binding" }>): string | number {
  const type = Array.isArray(schema.type) ? schema.type.find((value) => value !== "null") : schema.type;
  return type === "integer" || type === "number" ? 1 : `workflow-${binding.key}`;
}

function schemaProperties(schema: JsonObject): JsonObject {
  return record(schema.properties);
}

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
