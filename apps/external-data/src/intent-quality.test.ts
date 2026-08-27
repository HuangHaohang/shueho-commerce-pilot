import { describe, expect, it } from "vitest";

import { applyResearchIntentQuality } from "./intent-quality.js";
import type { ResearchIntent } from "./types.js";

describe("research intent quality gate", () => {
  it("rejects records outside the requested period before AI enrichment", () => {
    expect(applyResearchIntentQuality(
      { status: "valid", reasons: [], normalizedValue: "轻量通勤双肩包" },
      "2026-08-04T15:16:27.000Z",
      intent(),
    )).toMatchObject({ status: "rejected", reasons: ["OUTSIDE_REQUESTED_WINDOW"] });
  });

  it("keeps an in-window record eligible", () => {
    expect(applyResearchIntentQuality(
      { status: "valid", reasons: [], normalizedValue: "轻量通勤双肩包" },
      "2026-08-22T02:00:00.000Z",
      intent(),
    )).toMatchObject({ status: "valid", reasons: [] });
  });
});

function intent(): ResearchIntent {
  return {
    platform: "DOUYIN",
    targetProduct: "轻量通勤双肩包",
    metrics: ["interactions"],
    expectedCategories: ["轻量通勤双肩包"],
    excludedCategories: [],
    currency: null,
    requestedTopN: 50,
    originalRequest: "调研最近 7 天热门视频",
    objective: "interaction_ranked",
    timeRange: {
      start: "2026-08-20T16:00:00.000Z",
      end: "2026-08-27T15:59:59.999Z",
      startDate: "2026-08-21",
      endDate: "2026-08-27",
      timezone: "Asia/Shanghai",
    },
    windowEnforcement: "warehouse_post_filter",
  };
}
