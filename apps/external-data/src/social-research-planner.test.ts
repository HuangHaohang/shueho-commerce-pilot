import {readFileSync} from "node:fs";
import {researchPolicySchema,localDateBoundary} from "./research-policy.js";
const policy=researchPolicySchema.parse(JSON.parse(readFileSync(new URL("../catalog/research-policy.v1.json",import.meta.url),"utf8")));
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
    ], request("latest_content"),policy);

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
    ], request("interaction_ranked"),policy);

    expect(plan.endpoint.endpointId).toBe("douyin.hot_search_v1");
    expect(plan.normalizedParams).toMatchObject({ keyword: "轻量通勤双肩包", sortType: "HIGH_INTERACTION", page: 1 });
    expect(plan.coverage).toMatchObject({ window_enforcement: "warehouse_post_filter", collection: {pagination:{kind:"page"}} });
  });

  it("maps actual popularity sort fields without claiming an exact interaction sum", () => {
    const plan=selectSocialContentResearchPlan([endpoint("xiaohongshu.search_note_v4","xiaohongshu",{
      keyword:{type:"string"},sortType:{type:"string",enum:["general","popularity_descending"]},
    })],{...request("interaction_ranked"),platform:"XIAOHONGSHU"},policy);
    expect(plan.normalizedParams).toMatchObject({sortType:"popularity_descending"});
    expect(plan.coverage.ranking_basis).toBe("provider_popularity_not_exact_interaction_sum");
  });

  it("fails closed when no endpoint satisfies the requested business capability", () => {
    expect(() => selectSocialContentResearchPlan([], request("latest_content"),policy)).toThrowError(SocialResearchPlanningError);
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

it("uses IANA calendar boundaries including DST rather than a fixed eight-hour offset",()=>{
 expect(localDateBoundary("2026-03-08","America/New_York")).toBe("2026-03-08T05:00:00.000Z");
 expect(localDateBoundary("2026-03-08","America/New_York",true)).toBe("2026-03-09T03:59:59.999Z");
 const unknown={...policy,social:[]};
 expect(()=>selectSocialContentResearchPlan([],request("latest_content"),unknown)).toThrow(SocialResearchPlanningError);
});
