import type { ExternalDataServiceMcpClient } from "./external-data-service-mcp-client.js";

export type SocialContentResearchInput = {
  platform: string;
  keyword: string;
  start_date: string;
  end_date: string;
  objective: "latest_content" | "interaction_ranked";
  requested_metrics: Array<"views" | "likes" | "comments" | "shares" | "interactions">;
  max_results: number;
};

export type SocialContentResearchPreflight = {
  endpointId: string;
  catalogPlatform: string;
  normalizedParams: Record<string, unknown>;
  planKey: string;
  businessIntent: Record<string, unknown>;
  coverage: Record<string, unknown>;
};

export class SocialContentResearchPreflightError extends Error {
  readonly providerDispatched = false;

  constructor(message: string, readonly code = "SOCIAL_RESEARCH_PREFLIGHT_FAILED") {
    super(message);
    this.name = "SocialContentResearchPreflightError";
  }
}

export async function preflightSocialContentResearch(
  service: Pick<ExternalDataServiceMcpClient, "preflightSocialContentResearch">,
  input: SocialContentResearchInput,
  authorization?: { allowedPlatforms: string[]; allowedEndpointIds: string[] },
): Promise<SocialContentResearchPreflight> {
  const result = await service.preflightSocialContentResearch({
    ...input,
    ...(authorization ? {
      allowed_catalog_platforms: authorization.allowedPlatforms,
      allowed_endpoint_ids: authorization.allowedEndpointIds,
    } : {}),
  });
  const payload = result.payload;
  if (payload.success !== true) {
    throw new SocialContentResearchPreflightError(
      typeof payload.message === "string" ? payload.message : "社交内容研究请求无法匹配可用数据能力。",
      typeof payload.code === "string" ? payload.code : undefined,
    );
  }
  if (
    payload.business_tool !== "research_social_content" ||
    typeof payload.endpoint_id !== "string" ||
    typeof payload.platform !== "string" ||
    typeof payload.research_plan_key !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.research_plan_key) ||
    !isRecord(payload.normalized_params) ||
    !isRecord(payload.business_intent) ||
    !isRecord(payload.coverage)
  ) {
    throw new SocialContentResearchPreflightError("社交内容研究预检返回了无效计划。", "INVALID_SOCIAL_RESEARCH_PLAN");
  }
  return {
    endpointId: payload.endpoint_id,
    catalogPlatform: payload.platform,
    normalizedParams: payload.normalized_params,
    planKey: payload.research_plan_key,
    businessIntent: payload.business_intent,
    coverage: payload.coverage,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
