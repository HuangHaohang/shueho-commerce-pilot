import { describe, expect, it } from "vitest";

import { assessProductMetrics, publicEvidenceAssessment, researchAnalysisReadiness } from "./evidence-assessment.js";
import { enrichCandidates } from "./enrichment.js";
import type { LocalModelClient } from "./local-model-client.js";
import { assessTaobaoItemQuality } from "./quality.js";
import type { EnrichmentCandidate, ResearchIntent } from "./types.js";

describe("independent metric eligibility", () => {
  it.each([null, undefined, "", false, "NaN"])("does not turn absent/invalid price %s into zero", (value) => {
    expect(assessProductMetrics({ price_amount: value, currency: "CNY" }, "/items/0").price.status).not.toBe("available");
  });

  it("accepts explicit zero with currency and preserves foreign currencies", () => {
    expect(assessProductMetrics({ price_amount: 0, currency: "THB" }, "/items/0").price)
      .toMatchObject({ status: "available", amount: 0, currency: "THB", sourceJsonPointer: "/items/0" });
    expect(assessProductMetrics({ price_amount: 10 }, null).price.status).toBe("invalid");
    expect(assessProductMetrics({ price_amount: -1, currency: "CNY" }, null).price.status).toBe("invalid");
  });

  it("never infers sales from reviews, volume, field names or unreadable sales text", () => {
    expect(assessProductMetrics({ review_count_lower_bound: 10000, volume: 3, sold: true }, null).sales.status).toBe("missing");
    expect(assessProductMetrics({ sales_display: "热卖中" }, null).sales.status).toBe("invalid");
    expect(assessProductMetrics({ sales_lower_bound: null, sales_qualifier: "exact" }, null).sales.status).toBe("invalid");
    expect(assessProductMetrics({ sales_lower_bound: -1, sales_upper_bound: -1, sales_qualifier: "exact" }, null).sales.status).toBe("invalid");
    expect(assessProductMetrics({ sales_lower_bound: 20, sales_upper_bound: 10, sales_qualifier: "range" }, null).sales.status).toBe("invalid");
  });

  it("keeps exact zero and open intervals distinct, without inventing a sales period", () => {
    expect(assessProductMetrics({ sales_lower_bound: 0, sales_upper_bound: 0, sales_qualifier: "exact" }, null).sales)
      .toMatchObject({ status: "available", lowerBound: 0, upperBound: 0, qualifier: "exact", period: null });
    expect(assessProductMetrics({ sales_lower_bound: 1000, sales_upper_bound: null, sales_qualifier: "gte" }, null).sales)
      .toMatchObject({ status: "available", lowerBound: 1000, upperBound: null, qualifier: "gte" });
    expect(assessProductMetrics({ sales_lower_bound: 1000, sales_upper_bound: 1200, sales_qualifier: "gte" }, null).sales.status)
      .toBe("invalid");
  });

  it("does not reject a valid product just because its price is missing or invalid", () => {
    expect(assessTaobaoItemQuality({ itemId: "123", itemName: "通勤双肩包" }).status).toBe("valid");
    expect(assessTaobaoItemQuality({ itemId: "123", itemName: "通勤双肩包", priceYuanDouble: -1 }).status).toBe("valid");
    expect(assessTaobaoItemQuality({ itemName: "通勤双肩包" }).status).toBe("rejected");
  });

  it("does not report complete analysis or sales ranking just because processing succeeded", () => {
    expect(researchAnalysisReadiness({ processingComplete: true,
      requestedMetrics: ["price_band", "sales_level"], availableMetrics: ["price_band"],
      products: [{ price_amount: 20, currency: "CNY", review_count_lower_bound: 10000 }],
    })).toMatchObject({ processingComplete: true, requestedMetricCoverage: "partial",
      missingRequestedMetrics: ["sales_level"], productsWithUsablePrice: 1,
      productsWithUsableSales: 0, homogeneousCohortVerified: false, salesRanking: { supported: false } });
  });

  it("exposes decision provenance without private thresholds or fake probabilities", () => {
    const projected = publicEvidenceAssessment({ promptVersion: "commerce-relevance-v4", assessment: {
      scope: { status: "model_supported", thresholds: { rerankMinScore: 0.55 } }, metrics: {},
    } });
    expect(projected).toMatchObject({ scope: { status: "model_supported", homogeneousCohortVerified: false },
      ranking: { kind: "relevance_only", calibratedProbability: false } });
    expect(JSON.stringify(projected)).not.toContain("threshold");
    expect(publicEvidenceAssessment(null)).toMatchObject({ scope: { status: "legacy_unassessed" } });
  });
});

describe("scope, rank and metrics cannot substitute for one another", () => {
  const intent: ResearchIntent = {
    platform: "jd", targetProduct: "电脑包", metrics: ["sales_level"], expectedCategories: ["电脑包"],
    excludedCategories: [], currency: "CNY", requestedTopN: 10, originalRequest: "调研电脑包",
  };
  const candidate = (id: string, metrics: Record<string, unknown>, status: "valid" | "rejected" = "valid"): EnrichmentCandidate => ({
    entityType: "generic_record", entityId: id, sourceJsonPointer: `/items/${id}`,
    content: `电脑包；价格销量：${JSON.stringify(metrics)}`,
    quality: { status, normalizedValue: "电脑包", reasons: [] }, supportsPrice: true, supportsSales: true,
    metadata: { title: "电脑包", recordKind: "product", metrics },
  });

  it("uses the same scope decision for identical products regardless of metric completeness", async () => {
    const documents: string[] = [];
    const models = {
      embed: async (texts: string[]) => texts.map((text) => text.includes("价格销量：") ? [0, 1] : [1, 0]),
      rerank: async (_query: string, texts: string[]) => { documents.push(...texts); return texts.map(() => 0.9); },
    } as unknown as LocalModelClient;
    const candidates = [candidate("1", { price_amount: 20, currency: "CNY" }), candidate("2", {})];
    const before = JSON.stringify(candidates);
    const result = await enrichCandidates({ requestText: intent.originalRequest, intent, candidates, models });
    expect(result.decisions.map((row) => row.decision)).toEqual(["promote", "promote"]);
    expect(result.decisions[0]?.relevanceScore).toBe(result.decisions[1]?.relevanceScore);
    expect(result.decisions.map((row) => row.supportsPrice)).toEqual([true, false]);
    expect(result.decisions.map((row) => row.supportsSales)).toEqual([false, false]);
    expect(documents).toEqual(["电脑包", "电脑包"]);
    expect(result.embeddings.get("1")).toEqual([0, 1]); // Stored-content vector, not scope vector.
    expect(JSON.stringify(candidates)).toBe(before);
  });

  it("cannot buy admission with full metrics or high lexical rank, and skips corrupt text", async () => {
    const models = {
      embed: async (texts: string[]) => texts.map(() => [1, 0]),
      rerank: async (_query: string, texts: string[]) => texts.map(() => 0.1),
    } as unknown as LocalModelClient;
    const result = await enrichCandidates({ requestText: intent.originalRequest, intent, models, candidates: [
      candidate("1", { price_amount: 30, currency: "CNY", sales_lower_bound: 10, sales_upper_bound: 10, sales_qualifier: "exact" }),
      candidate("2", {}, "rejected"),
    ] });
    expect(result.decisions[0]).toMatchObject({ decision: "hold", lexicalScore: 1, supportsPrice: true, supportsSales: true });
    expect(result.decisions[1]).toMatchObject({ decision: "reject", embeddingScore: null, rerankScore: null });
    expect(result.embeddings.has("2")).toBe(false);
  });
});
