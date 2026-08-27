import assert from "node:assert/strict";
import test from "node:test";

import {
  preflightSocialContentResearch,
  SocialContentResearchPreflightError,
} from "./social-content-research-preflight.js";

const request = {
  platform: "DOUYIN",
  keyword: "轻量通勤双肩包",
  start_date: "2026-08-21",
  end_date: "2026-08-27",
  objective: "latest_content" as const,
  requested_metrics: ["views", "likes"] as Array<"views" | "likes">,
  max_results: 50,
};

test("returns the service-selected endpoint and immutable business plan before reservation", async () => {
  const result = await preflightSocialContentResearch({
    preflightSocialContentResearch: async () => ({
      payload: {
        success: true,
        business_tool: "research_social_content",
        research_plan_key: "a".repeat(64),
        endpoint_id: "search.search_v1",
        platform: "search",
        normalized_params: { keyword: request.keyword, source: "DOUYIN" },
        business_intent: { kind: "social_content_research" },
        coverage: { window_enforcement: "provider_exact" },
      },
      resultBytes: 1,
      isError: false,
    }),
  }, request);
  assert.equal(result.endpointId, "search.search_v1");
  assert.equal(result.catalogPlatform, "search");
  assert.equal(result.coverage.window_enforcement, "provider_exact");
});

test("fails closed when no provider capability satisfies the business request", async () => {
  await assert.rejects(
    () => preflightSocialContentResearch({
      preflightSocialContentResearch: async () => ({
        payload: { success: false, code: "CAPABILITY_UNAVAILABLE", message: "no exact-window endpoint" },
        resultBytes: 1,
        isError: false,
      }),
    }, request),
    (error: unknown) => error instanceof SocialContentResearchPreflightError &&
      error.code === "CAPABILITY_UNAVAILABLE" && error.providerDispatched === false,
  );
});
