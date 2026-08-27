import { sha256Json } from "./canonical.js";
import { listEnabledEndpoints, validateEndpointParams } from "./endpoint-registry.js";
import type { JsonObject, ProviderEndpoint } from "./types.js";

export type SocialResearchObjective = "latest_content" | "interaction_ranked";
export type SocialResearchMetric = "views" | "likes" | "comments" | "shares" | "interactions";

export type SocialResearchRequest = {
  platform: string;
  keyword: string;
  startDate: string;
  endDate: string;
  objective: SocialResearchObjective;
  requestedMetrics: SocialResearchMetric[];
  maxResults: number;
};

export type SocialResearchPlan = {
  planKey: string;
  endpoint: ProviderEndpoint;
  params: JsonObject;
  normalizedParams: JsonObject;
  businessIntent: JsonObject;
  coverage: JsonObject;
};

export type SocialResearchConstraints = {
  allowedCatalogPlatforms?: string[];
  allowedEndpointIds?: string[];
};

export class SocialResearchPlanningError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_RESEARCH_REQUEST" | "CAPABILITY_UNAVAILABLE",
    readonly details: JsonObject = {},
  ) {
    super(message);
    this.name = "SocialResearchPlanningError";
  }
}

export async function planSocialContentResearch(
  input: SocialResearchRequest,
  constraints: SocialResearchConstraints = {},
): Promise<SocialResearchPlan> {
  const endpoints = (await listEnabledEndpoints()).filter((endpoint) =>
    (!constraints.allowedCatalogPlatforms?.length || constraints.allowedCatalogPlatforms.includes(endpoint.platformId)) &&
    (!constraints.allowedEndpointIds?.length || constraints.allowedEndpointIds.includes(endpoint.endpointId))
  );
  return selectSocialContentResearchPlan(endpoints, input);
}

export function selectSocialContentResearchPlan(
  endpoints: ProviderEndpoint[],
  input: SocialResearchRequest,
): SocialResearchPlan {
  const request = normalizeRequest(input);
  const selected = request.objective === "latest_content"
    ? selectLatestContentEndpoint(endpoints, request.platform)
    : selectInteractionEndpoint(endpoints, request.platform);
  if (!selected) {
    throw new SocialResearchPlanningError(
      request.objective === "latest_content"
        ? `当前已授权接口中没有同时支持 ${request.platform}、关键词和精确起止时间的社交内容查询。`
        : `当前已授权接口中没有支持 ${request.platform} 关键词和高互动排序的内容查询。`,
      "CAPABILITY_UNAVAILABLE",
      {
        platform: request.platform,
        objective: request.objective,
        providerDispatched: false,
      },
    );
  }

  const params = request.objective === "latest_content"
    ? {
        keyword: request.keyword,
        source: request.platform,
        start: `${request.startDate} 00:00:00`,
        end: `${request.endDate} 23:59:59`,
      }
    : {
        keyword: request.keyword,
        sortType: "HIGH_INTERACTION",
      };
  const normalizedParams = validateEndpointParams(selected, params);
  const start = new Date(`${request.startDate}T00:00:00+08:00`).toISOString();
  const end = new Date(`${request.endDate}T23:59:59.999+08:00`).toISOString();
  const windowEnforcement = request.objective === "latest_content" ? "provider_exact" : "warehouse_post_filter";
  const businessIntent: JsonObject = {
    kind: "social_content_research",
    platform: request.platform,
    target_product: request.keyword,
    objective: request.objective,
    requested_metrics: request.requestedMetrics,
    time_range: {
      start,
      end,
      start_date: request.startDate,
      end_date: request.endDate,
      timezone: "Asia/Shanghai",
    },
    window_enforcement: windowEnforcement,
    requested_top_n: request.maxResults,
  };
  const coverage: JsonObject = {
    requested_platform: request.platform,
    requested_keyword: request.keyword,
    requested_start_date: request.startDate,
    requested_end_date: request.endDate,
    objective: request.objective,
    window_enforcement: windowEnforcement,
    requested_metrics: request.requestedMetrics,
    metric_coverage: request.objective === "interaction_ranked"
      ? "provider_reported_when_present"
      : "not_guaranteed_by_endpoint_contract",
    provider_calls: 1,
  };
  return {
    planKey: sha256Json({
      contractVersion: 1,
      businessTool: "research_social_content",
      endpointId: selected.endpointId,
      schemaVersion: selected.schemaVersion,
      normalizedParams,
      businessIntent,
    }),
    endpoint: selected,
    params,
    normalizedParams,
    businessIntent,
    coverage,
  };
}

function selectLatestContentEndpoint(endpoints: ProviderEndpoint[], platform: string): ProviderEndpoint | null {
  return endpoints
    .filter((endpoint) => {
      const properties = schemaProperties(endpoint.requestSchema);
      const source = record(properties.source);
      return properties.keyword !== undefined && properties.start !== undefined && properties.end !== undefined &&
        properties.source !== undefined && stringArray(source.enum).includes(platform);
    })
    .sort(compareEndpointSpecificity)[0] ?? null;
}

function selectInteractionEndpoint(endpoints: ProviderEndpoint[], platform: string): ProviderEndpoint | null {
  const platformId = platform.toLowerCase();
  return endpoints
    .filter((endpoint) => {
      const properties = schemaProperties(endpoint.requestSchema);
      const sortType = record(properties.sortType);
      return endpoint.platformId === platformId && properties.keyword !== undefined &&
        stringArray(sortType.enum).includes("HIGH_INTERACTION");
    })
    .sort(compareEndpointSpecificity)[0] ?? null;
}

function compareEndpointSpecificity(left: ProviderEndpoint, right: ProviderEndpoint): number {
  const leftCount = Object.keys(schemaProperties(left.requestSchema)).length;
  const rightCount = Object.keys(schemaProperties(right.requestSchema)).length;
  return rightCount - leftCount || left.endpointId.localeCompare(right.endpointId);
}

function normalizeRequest(input: SocialResearchRequest): SocialResearchRequest {
  const platform = input.platform.normalize("NFKC").trim().toUpperCase();
  const keyword = input.keyword.normalize("NFKC").trim().replace(/\s+/g, " ");
  const startDate = validDate(input.startDate);
  const endDate = validDate(input.endDate);
  const start = Date.parse(`${startDate}T00:00:00+08:00`);
  const end = Date.parse(`${endDate}T23:59:59.999+08:00`);
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (!/^[A-Z0-9_]{2,64}$/.test(platform) || !keyword || keyword.length > 500) {
    throw new SocialResearchPlanningError("社交内容研究的平台或关键词无效。", "INVALID_RESEARCH_REQUEST");
  }
  if (start > end || days > 366) {
    throw new SocialResearchPlanningError("社交内容研究时间范围无效或超过 366 天。", "INVALID_RESEARCH_REQUEST");
  }
  if (input.objective !== "latest_content" && input.objective !== "interaction_ranked") {
    throw new SocialResearchPlanningError("社交内容研究目标无效。", "INVALID_RESEARCH_REQUEST");
  }
  const requestedMetrics = [...new Set(input.requestedMetrics)].sort() as SocialResearchMetric[];
  if (requestedMetrics.some((metric) => !["views", "likes", "comments", "shares", "interactions"].includes(metric))) {
    throw new SocialResearchPlanningError("社交内容研究指标无效。", "INVALID_RESEARCH_REQUEST");
  }
  if (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 100) {
    throw new SocialResearchPlanningError("社交内容研究结果上限必须为 1 到 100。", "INVALID_RESEARCH_REQUEST");
  }
  return { ...input, platform, keyword, startDate, endDate, requestedMetrics };
}

function validDate(value: string): string {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new SocialResearchPlanningError("日期必须使用 YYYY-MM-DD 格式。", "INVALID_RESEARCH_REQUEST");
  }
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new SocialResearchPlanningError("日期不是有效的公历日期。", "INVALID_RESEARCH_REQUEST");
  }
  return normalized;
}

function schemaProperties(schema: JsonObject): JsonObject {
  return record(schema.properties);
}

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
