import { describe, expect, it } from "vitest";

import { curateBusinessSearchResult } from "./hybrid-search.js";

describe("curateBusinessSearchResult", () => {
  it("keeps bounded business evidence and removes tenancy and retrieval internals", () => {
    const result = curateBusinessSearchResult({
      entity_type: "product",
      evidence_kind: "product",
      id: "product-id",
      title: "蘑菇勺",
      price_yuan: 19.9,
      source_name: "淘宝",
      canonical_url: "https://item.taobao.com/item.htm?id=1",
      observed_at: "2026-08-26T00:00:00.000Z",
      research_request_id: "research-id",
      query_key: "query-key",
      metrics: { price_yuan: 19.9 },
      published_at: null,
      quality_basis: "ai_promoted_text",
      confidence: 0.88,
      relevance_score: 0.8,
      rerank_score: 0.9,
      tenant_id: "tenant-secret",
      workspace_id: "workspace-secret",
      vector_score: 0.7,
      elastic_score: 1.2,
      reciprocal_rank_score: 0.03,
    });
    expect(result).toMatchObject({
      entity_type: "product",
      evidence_id: "product-id",
      evidence_kind: "product",
      title: "蘑菇勺",
      price_yuan: 19.9,
      research_request_id: "research-id",
      query_key: "query-key",
      source_name: "淘宝",
      canonical_url: "https://item.taobao.com/item.htm?id=1",
      observed_at: "2026-08-26T00:00:00.000Z",
      metrics: { price_yuan: 19.9 },
      quality_basis: "ai_promoted_text",
      confidence: 0.88,
      retrieval_score: 0.9,
    });
    expect(result).not.toHaveProperty("tenant_id");
    expect(result).not.toHaveProperty("workspace_id");
    expect(result).not.toHaveProperty("vector_score");
    expect(result).not.toHaveProperty("elastic_score");
    expect(result).not.toHaveProperty("reciprocal_rank_score");
  });
});
