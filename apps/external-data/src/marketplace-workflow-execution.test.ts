import { describe, expect, it } from "vitest";

import {
  extractBindings,
  ensureMarketplaceEvidenceId,
  marketplaceReviewEvidenceLimitations,
  summarizeMarketplaceReviewEvidence,
} from "./marketplace-workflow-execution.js";

describe("marketplace workflow binding extraction", () => {
  it("extracts identifiers from one quality-selected product record", () => {
    expect(extractBindings({
      title: "轻量通勤双肩包",
      product: { skuId: "100012345", shopId: 88221 },
    }, [
      { name: "item_id", aliases: ["itemId", "skuId"], value_type: "string" },
      { name: "shop_id", aliases: ["shopId"], value_type: "integer" },
    ])).toEqual({ item_id: "100012345", shop_id: 88221 });
  });

  it("fails closed when any required identifier is absent or malformed", () => {
    expect(extractBindings({ itemId: "abc 123" }, [
      { name: "item_id", aliases: ["itemId"], value_type: "string" },
    ])).toBeNull();
    expect(extractBindings({ itemId: "123" }, [
      { name: "item_id", aliases: ["itemId"], value_type: "string" },
      { name: "shop_id", aliases: ["shopId"], value_type: "integer" },
    ])).toBeNull();
  });
});

describe("marketplace evidence receipts", () => {
  it("preserves stored evidence ids and derives a stable receipt for legacy rows", () => {
    const stored = { evidence_id: "11111111-1111-4111-8111-111111111111", title: "釉面易清洁" };
    expect(ensureMarketplaceEvidenceId(stored)).toBe(stored);
    const legacy = { research_request_id: "research-1", evidence_kind: "comment", title: "锅盖烫手" };
    const first = ensureMarketplaceEvidenceId(legacy);
    const second = ensureMarketplaceEvidenceId(legacy);
    expect(first.evidence_id).toBe(second.evidence_id);
    expect(first.evidence_id).toMatch(/^evidence_[a-f0-9]{64}$/);
  });
});

describe("marketplace review evidence coverage", () => {
  it("counts only completed review instances and attributable review evidence", () => {
    expect(summarizeMarketplaceReviewEvidence([
      { role: "discovery", state: "completed", is_template: false },
      { role: "reviews", state: "skipped", is_template: true },
      { role: "reviews", state: "completed", is_template: false },
      { role: "reviews", state: "processing_failed", is_template: false },
    ], [
      { workflow_role: "reviews", evidence_kind: "comment" },
      { workflow_role: "reviews", evidence_kind: "metric" },
      { workflow_role: "detail", evidence_kind: "content" },
    ])).toEqual({
      reviewStepAvailable: true,
      reviewStepsPlanned: 2,
      reviewStepsCompleted: 1,
      reviewEvidenceCount: 1,
    });
  });

  it("does not treat product detail or social content as buyer review coverage", () => {
    const coverage = summarizeMarketplaceReviewEvidence([
      { role: "discovery", state: "completed", is_template: false },
      { role: "detail", state: "completed", is_template: false },
    ], [
      { workflow_role: "detail", evidence_kind: "content" },
      { workflow_role: "detail", evidence_kind: "product" },
    ]);
    expect(coverage).toEqual({
      reviewStepAvailable: false,
      reviewStepsPlanned: 0,
      reviewStepsCompleted: 0,
      reviewEvidenceCount: 0,
    });
    expect(marketplaceReviewEvidenceLimitations(coverage).join(" ")).toContain("不得解释为买家评价或消费者痛点");
  });

  it("forbids pain-point conclusions when a completed review step yields zero accepted evidence", () => {
    const coverage = summarizeMarketplaceReviewEvidence([
      { role: "reviews", state: "completed", is_template: false },
    ], []);
    expect(marketplaceReviewEvidenceLimitations(coverage).join(" ")).toContain("不得据此生成消费者痛点结论");
  });
});
