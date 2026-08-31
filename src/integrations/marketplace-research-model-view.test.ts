import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeMarketplaceResearchForModel } from "./marketplace-research-model-view.js";

test("keeps business evidence receipts and removes internal warehouse and provider routing fields", () => {
  const sanitized = sanitizeMarketplaceResearchForModel({
    success: true,
    research_request_id: "11111111-1111-4111-8111-111111111111",
    raw_archive_id: "22222222-2222-4222-8222-222222222222",
    endpoint_id: "taobao.get_item_comment_v3",
    observed_at: "2026-08-31T00:00:00.000Z",
    coverage: { review_evidence_count: 2, market_profile_id: "private-profile" },
    evidence: [{
      evidence_id: "33333333-3333-4333-8333-333333333333",
      research_request_id: "11111111-1111-4111-8111-111111111111",
      workflow_role: "reviews",
      evidence_kind: "comment",
      canonical_url: "https://example.test/review/1",
      metrics: { rating: 2 },
      published_at: "2026-08-01T00:00:00.000Z",
      quality_basis: "ai_promoted_text",
      confidence: 0.91,
      author: "public-profile-name",
      source_record_id: "internal-record",
      source_raw_call_id: "internal-raw-call",
      source_json_pointer: "/data/reviews/0",
      profileRevision: "private-revision",
    }],
    limitations: ["评价样本不是全量交易评价。"],
  });

  assert.deepEqual(sanitized, {
    success: true,
    research_request_id: "11111111-1111-4111-8111-111111111111",
    observed_at: "2026-08-31T00:00:00.000Z",
    coverage: { review_evidence_count: 2 },
    evidence: [{
      evidence_id: "33333333-3333-4333-8333-333333333333",
      research_request_id: "11111111-1111-4111-8111-111111111111",
      workflow_role: "reviews",
      evidence_kind: "comment",
      canonical_url: "https://example.test/review/1",
      metrics: { rating: 2 },
      published_at: "2026-08-01T00:00:00.000Z",
      quality_basis: "ai_promoted_text",
      confidence: 0.91,
    }],
    limitations: ["评价样本不是全量交易评价。"],
  });
});

test("removes camel-case credentials and raw payloads recursively", () => {
  const sanitized = sanitizeMarketplaceResearchForModel({
    nested: {
      rawPayload: { complete: true },
      responsePayload: { records: [] },
      providerToken: "secret",
      safe: "value",
    },
  });
  assert.deepEqual(sanitized, { nested: { safe: "value" } });
});

test("keeps only executable plan and billable receipts while removing workflow routing and vendor cost", () => {
  const sanitized = sanitizeMarketplaceResearchForModel({
    success: true,
    plan_id: "11111111-1111-4111-8111-111111111111",
    research_plan_key: "a".repeat(64),
    planKey: "b".repeat(64),
    workflow_id: "taobao.products_by_keyword_v1",
    workflowVersion: "2.0.0",
    workflow_execution_id: "22222222-2222-4222-8222-222222222222",
    businessTool: "execute_marketplace_research",
    endpointId: "taobao.search_item_list_v1",
    vendor_cost_micros: 100_000,
    billable_amount_micros: 150_000,
    subject_receipt: {
      snapshot_sha256: "c".repeat(64),
      product_count: 1,
    },
    steps: [{
      step_id: "reviews",
      step_instance_key: "reviews_0",
      target_ordinal: 0,
      endpoint_id: "taobao.get_item_comment_v3",
      parameter_template: { itemId: "private-routing-value" },
    }],
    evidence: [{
      evidence_id: "33333333-3333-4333-8333-333333333333",
      research_request_id: "44444444-4444-4444-8444-444444444444",
      workflow_role: "reviews",
      workflow_target_ordinal: 0,
      evidence_kind: "comment",
      confidence: 0.9,
    }],
    coverage: { accepted_review_evidence_count: 1 },
    limitations: [],
  });

  assert.deepEqual(sanitized, {
    success: true,
    plan_id: "11111111-1111-4111-8111-111111111111",
    billable_amount_micros: 150_000,
    subject_receipt: {
      snapshot_sha256: "c".repeat(64),
      product_count: 1,
    },
    evidence: [{
      evidence_id: "33333333-3333-4333-8333-333333333333",
      research_request_id: "44444444-4444-4444-8444-444444444444",
      workflow_role: "reviews",
      evidence_kind: "comment",
      confidence: 0.9,
    }],
    coverage: { accepted_review_evidence_count: 1 },
    limitations: [],
  });
});
