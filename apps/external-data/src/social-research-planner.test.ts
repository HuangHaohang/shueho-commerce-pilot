import { describe, expect, it } from "vitest";

import {
  selectSocialContentResearchPlan,
  SocialResearchPlanningError,
} from "./social-research-planner.js";
import type { JsonObject, ProviderEndpoint } from "./types.js";

describe("social content research planning", () => {
  it("selects an exact-window cross-platform endpoint for latest content", () => {
    const plan = selectSocialContentResearchPlan([
      endpoint("search.search_v1", "search", {
        keyword: { type: "string" },
        source: { type: "string", enum: ["ALL", "DOUYIN"] },
        start: { type: "string" },
        end: { type: "string" },
      }),
      endpoint("douyin.hot_search_v1", "douyin", {
        keyword: { type: "string" },
        sortType: { type: "string", enum: ["COMPREHENSIVE", "HIGH_INTERACTION"] },
      }),
    ], request("latest_content"));

    expect(plan.endpoint.endpointId).toBe("search.search_v1");
    expect(plan.normalizedParams).toMatchObject({
      keyword: "轻量通勤双肩包",
      source: "DOUYIN",
      start: "2026-08-21 00:00:00",
      end: "2026-08-27 23:59:59",
    });
    expect(plan.businessIntent).toMatchObject({ window_enforcement: "provider_exact" });
  });

  it("selects a platform interaction endpoint and marks the date window for warehouse filtering", () => {
    const plan = selectSocialContentResearchPlan([
      endpoint("douyin.hot_search_v1", "douyin", {
        page: { type: "integer", default: 1 },
        keyword: { type: "string" },
        sortType: { type: "string", enum: ["COMPREHENSIVE", "HIGH_INTERACTION"] },
      }),
    ], request("interaction_ranked"));

    expect(plan.endpoint.endpointId).toBe("douyin.hot_search_v1");
    expect(plan.normalizedParams).toMatchObject({ keyword: "轻量通勤双肩包", sortType: "HIGH_INTERACTION", page: 1 });
    expect(plan.coverage).toMatchObject({ window_enforcement: "warehouse_post_filter", provider_calls: 1 });
  });

  it("fails closed when no endpoint satisfies the requested business capability", () => {
    expect(() => selectSocialContentResearchPlan([], request("latest_content"))).toThrowError(SocialResearchPlanningError);
  });
});

function request(objective: "latest_content" | "interaction_ranked") {
  return {
    platform: "DOUYIN",
    keyword: "轻量通勤双肩包",
    startDate: "2026-08-21",
    endDate: "2026-08-27",
    objective,
    requestedMetrics: ["views", "likes", "comments", "shares", "interactions"] as Array<
      "views" | "likes" | "comments" | "shares" | "interactions"
    >,
    maxResults: 50,
  };
}

function endpoint(endpointId: string, platformId: string, properties: JsonObject): ProviderEndpoint {
  return {
    endpointId,
    platformId,
    platformName: platformId,
    displayName: endpointId,
    capability: endpointId,
    apiPath: `/api/${endpointId.replaceAll(".", "/")}`,
    httpMethod: "GET",
    schemaVersion: "test-v1",
    requestSchema: { type: "object", additionalProperties: false, properties },
    responseSchema: {},
    requestCodec: { query: Object.keys(properties), form: [], path: [], header: [], bodyContentType: null },
    paginationStrategy: {},
    responseFamily: "content",
    normalizerVersion: "generic-json-v1",
    catalogStatus: "active",
    pricingStatus: "priced",
    permissionStatus: "allowed",
    enabled: true,
    documentationUrl: null,
    openapiUrl: null,
  };
}
