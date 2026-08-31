import { describe, expect, it } from "vitest";

import { readDynamicToolActivity, readMcpToolActivity } from "./tool-activity";

describe("tool activity metadata", () => {
  it("projects MCP Web Search to concrete sources without exposing its internal tool id", () => {
    expect(readMcpToolActivity({
      server: "commerce_web",
      tool: "search",
      result: {
        structuredContent: {
          sources: [{ title: "OpenAI", url: "https://openai.com/" }],
        },
      },
    })).toMatchObject({
      kind: "search",
      detail: null,
      isWebSearch: true,
      sources: [{ title: "OpenAI", url: "https://openai.com/" }],
    });
  });

  it("keeps non-search tool identity available for diagnostics", () => {
    expect(readDynamicToolActivity({ namespace: "commerce_image", tool: "generate" })).toMatchObject({
      kind: "image",
      detail: "commerce_image.generate",
      isWebSearch: false,
    });
  });

  it("shows a stable user-facing reason for restored provider timeouts", () => {
    expect(readMcpToolActivity({
      server: "commerce_web",
      tool: "search",
      status: "failed",
      result: { content: [{ type: "text", text: "Provider request timed out." }] },
    }).detail).toBe("网页搜索服务超时，请缩短查询范围后重试。");
  });

  it("projects only the safe fields from a free marketplace plan receipt", () => {
    const metadata = readDynamicToolActivity({
      namespace: "commerce_data",
      tool: "plan_marketplace_research",
      result: {
        contentItems: [{
          type: "inputText",
          text: JSON.stringify({
            state: "ready",
            expires_at: "2026-08-31T01:00:00.000Z",
            estimated_provider_calls: 7,
            plan_id: "not-rendered",
            quote: {
              currency: "CNY",
              provider_call_count: 7,
              priced: true,
              billable_amount_micros: 350000,
              vendor_cost_micros: 100000,
            },
            subject_receipt: {
              product_count: 1,
              snapshot_sha256: "a".repeat(64),
            },
            coverage: {
              requested_platform: "TAOBAO",
              requested_market: "CN",
              detailed_products_planned: 3,
              requested_metrics: ["price", "reviews"],
              first_party_subject: {
                product_count: 9,
                snapshot_sha256: "b".repeat(64),
                products: [{ product_id: "private-id" }],
              },
            },
          }),
        }],
      },
    });

    expect(metadata.research).toMatchObject({
      kind: "plan",
      productCount: 1,
      snapshotSha256: "a".repeat(64),
      estimatedProviderCalls: 7,
      quote: { billableAmountMicros: 350000 },
      coverage: { platform: "TAOBAO", plannedProducts: 3 },
    });
    expect(JSON.stringify(metadata.research)).not.toContain("plan_id");
    expect(JSON.stringify(metadata.research)).not.toContain("vendor_cost");
    expect(JSON.stringify(metadata.research)).not.toContain("private-id");
  });

  it("projects governed evidence lineage without raw archives, endpoints, authors, or rows", () => {
    const metadata = readDynamicToolActivity({
      namespace: "commerce_data",
      tool: "execute_marketplace_research",
      result: {
        contentItems: [{
          type: "inputText",
          text: JSON.stringify({
            research_request_id: "research-request-1",
            observed_at: "2026-08-31T00:00:00.000Z",
            raw_archive_id: "raw-secret",
            endpoint_id: "provider.private.endpoint",
            coverage: {
              requested_platform: "TAOBAO",
              acceptedProducts: 3,
              acceptedEvidence: 24,
              review_evidence_count: 18,
              review_steps_completed: 3,
              review_step_available: true,
            },
            evidence: [{ author: "private author", raw_data: { secret: true } }],
            limitations: ["样本只覆盖本次实际完成的调用。"],
          }),
        }],
      },
    });

    expect(metadata.research).toMatchObject({
      kind: "evidence",
      researchRequestId: "research-request-1",
      platform: "TAOBAO",
      evidenceCount: 24,
      reviewEvidenceCount: 18,
    });
    const serialized = JSON.stringify(metadata.research);
    expect(serialized).not.toMatch(/raw-secret|provider\.private|private author|raw_data/);
  });
});
