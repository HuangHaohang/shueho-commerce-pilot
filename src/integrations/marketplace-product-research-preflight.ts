import type { ExternalDataServiceMcpClient } from "./external-data-service-mcp-client.js";

export type MarketplaceProductResearchInput = {
  platform: string;
  keyword: string;
  localized_keyword: string | null;
  market: string | null;
  tmall_only: boolean;
  min_price_yuan: number | null;
  max_price_yuan: number | null;
  requested_metrics: Array<"price_band" | "sales_level" | "brand_competition" | "property_distribution">;
  max_results: number;
};

export type MarketplaceProductResearchStep = {
  stepId: string;
  stepOrder: number;
  role: "discovery" | "detail" | "price" | "reviews" | "sku";
  endpointId: string;
  catalogPlatform: string;
  parameterTemplate: Record<string, unknown>;
  dynamicParameterBindings: Record<string, string>;
  outputBindings: Array<{ name: string; aliases: string[]; valueType: "string" | "integer" }>;
  required: boolean;
};

export type MarketplaceProductResearchPreflight = {
  workflowId: string;
  workflowVersion: string;
  planKey: string;
  businessInput: Record<string, unknown>;
  businessIntent: Record<string, unknown>;
  coverage: Record<string, unknown>;
  steps: MarketplaceProductResearchStep[];
};

export class MarketplaceProductResearchPreflightError extends Error {
  readonly providerDispatched = false;

  constructor(
    message: string,
    readonly code = "MARKETPLACE_RESEARCH_PREFLIGHT_FAILED",
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MarketplaceProductResearchPreflightError";
  }
}

export async function preflightMarketplaceProductResearch(
  service: Pick<ExternalDataServiceMcpClient, "preflightMarketplaceProductResearch">,
  input: MarketplaceProductResearchInput,
  authorization?: { allowedPlatforms: string[]; allowedEndpointIds: string[] },
): Promise<MarketplaceProductResearchPreflight> {
  const result = await service.preflightMarketplaceProductResearch({
    ...input,
    ...(authorization ? {
      allowed_catalog_platforms: authorization.allowedPlatforms,
      allowed_endpoint_ids: authorization.allowedEndpointIds,
    } : {}),
  });
  const payload = result.payload;
  if (payload.success !== true) {
    throw new MarketplaceProductResearchPreflightError(
      typeof payload.message === "string" ? payload.message : "商品研究请求无法匹配可用数据能力。",
      typeof payload.code === "string" ? payload.code : undefined,
      isRecord(payload.details) ? payload.details : {},
    );
  }
  if (
    payload.business_tool !== "research_marketplace_products" ||
    typeof payload.workflow_id !== "string" || typeof payload.workflow_version !== "string" ||
    typeof payload.research_plan_key !== "string" || !/^[a-f0-9]{64}$/.test(payload.research_plan_key) ||
    !isRecord(payload.business_input) || !isRecord(payload.business_intent) || !isRecord(payload.coverage) ||
    !Array.isArray(payload.steps)
  ) {
    throw new MarketplaceProductResearchPreflightError("商品研究预检返回了无效工作流。", "INVALID_MARKETPLACE_RESEARCH_PLAN");
  }
  const steps = payload.steps.map(readStep);
  if (!steps.length || steps.length > 10 || steps.some((step, index) => step.stepOrder !== index)) {
    throw new MarketplaceProductResearchPreflightError("商品研究工作流步骤不完整。", "INVALID_MARKETPLACE_RESEARCH_STEPS");
  }
  return {
    workflowId: payload.workflow_id,
    workflowVersion: payload.workflow_version,
    planKey: payload.research_plan_key,
    businessInput: payload.business_input,
    businessIntent: payload.business_intent,
    coverage: payload.coverage,
    steps,
  };
}

function readStep(value: unknown): MarketplaceProductResearchStep {
  if (!isRecord(value)) throw invalidStep();
  const role = value.role;
  if (
    typeof value.step_id !== "string" || typeof value.step_order !== "number" || !Number.isInteger(value.step_order) ||
    (role !== "discovery" && role !== "detail" && role !== "price" && role !== "reviews" && role !== "sku") ||
    typeof value.endpoint_id !== "string" || typeof value.platform !== "string" ||
    !isRecord(value.parameter_template) || !isRecord(value.dynamic_parameter_bindings) ||
    !Array.isArray(value.output_bindings)
  ) throw invalidStep();
  const dynamicParameterBindings = Object.fromEntries(Object.entries(value.dynamic_parameter_bindings)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  if (Object.keys(dynamicParameterBindings).length !== Object.keys(value.dynamic_parameter_bindings).length) throw invalidStep();
  const outputBindings = value.output_bindings.map((binding) => {
    if (
      !isRecord(binding) || typeof binding.name !== "string" || !Array.isArray(binding.aliases) ||
      binding.aliases.some((alias) => typeof alias !== "string") ||
      (binding.value_type !== "string" && binding.value_type !== "integer")
    ) throw invalidStep();
    return {
      name: binding.name,
      aliases: binding.aliases as string[],
      valueType: binding.value_type as "string" | "integer",
    };
  });
  return {
    stepId: value.step_id,
    stepOrder: value.step_order,
    role,
    endpointId: value.endpoint_id,
    catalogPlatform: value.platform,
    parameterTemplate: value.parameter_template,
    dynamicParameterBindings,
    outputBindings,
    required: value.required !== false,
  };
}

function invalidStep(): MarketplaceProductResearchPreflightError {
  return new MarketplaceProductResearchPreflightError("商品研究工作流步骤无效。", "INVALID_MARKETPLACE_RESEARCH_STEP");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
