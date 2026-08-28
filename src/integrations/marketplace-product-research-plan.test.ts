import assert from "node:assert/strict";
import test from "node:test";

import {
  createMarketplaceProductResearchPlan,
  executeMarketplaceProductResearchPlan,
} from "./marketplace-product-research-plan.js";

const context = {
  tenant_id: "00000000-0000-4000-8000-000000000001",
  workspace_id: "00000000-0000-4000-8000-000000000002",
  user_id: "user-1",source: "codex_harness",source_call_id: "call-12345678",
  thread_id: "thread-12345678",turn_id: "turn-12345678",request_text: "调研商品",top_n: 20,
};
const authorization = { allowedPlatforms: ["shopee"],allowedEndpointIds: [] };

test("reads an immutable free marketplace plan receipt",async () => {
  const service = {
    planMarketplaceProductResearch: async () => result(planPayload()),
  };
  const plan = await createMarketplaceProductResearchPlan(service as never,{
    platform: "SHOPEE",keyword: "休闲运动裤",localized_keywords: ["休閒運動褲"],market: "TW",
    tmall_only: false,min_price_yuan: null,max_price_yuan: null,
    requested_metrics: ["price_band"],max_results: 20,detail_sample_size: 3,
  },context,authorization);
  assert.equal(plan.planId,"00000000-0000-4000-8000-000000000010");
  assert.equal(plan.detailSampleSize,3);
  assert.equal(plan.estimatedProviderCalls,7);
  assert.equal(plan.marketContext.preferredQueryLocale,"zh-Hant-TW");
});

test("reads target-specific executable step instances",async () => {
  const service = {
    executeMarketplaceProductResearchPlan: async () => result({
      ...planPayload(),
      workflow_execution_id: "00000000-0000-4000-8000-000000000020",
      step_instances: [{
        stepInstanceId: "00000000-0000-4000-8000-000000000030",
        stepInstanceKey: "discover",targetId: null,targetOrdinal: null,
        stepId: "discover",stepOrder: 0,instanceOrder: 0,role: "discovery",
        endpointId: "shopee.search_item_list_v1",bindings: {},
      }],
    }),
  };
  const executable = await executeMarketplaceProductResearchPlan(
    service as never,"00000000-0000-4000-8000-000000000010",context,authorization,
  );
  assert.equal(executable.executionId,"00000000-0000-4000-8000-000000000020");
  assert.equal(executable.stepInstances[0]?.stepInstanceKey,"discover");
});

function planPayload() {
  return {
    success: true,plan_id: "00000000-0000-4000-8000-000000000010",
    request_text: "调研商品",expires_at: "2026-08-28T09:00:00.000Z",
    research_plan_key: "a".repeat(64),workflow_id: "shopee.products_by_keyword_v1",
    workflow_version: "2.0.0",market_context: { preferredQueryLocale: "zh-Hant-TW" },
    detail_sample_size: 3,estimated_provider_calls: 7,
    business_input: { platform: "SHOPEE",keyword: "休闲运动裤",max_results: 20 },
    business_intent: { kind: "marketplace_product_research" },coverage: {},
    steps: [{
      step_id: "discover",step_order: 0,role: "discovery",
      endpoint_id: "shopee.search_item_list_v1",platform: "shopee",
      parameter_template: { keyword: "休閒運動褲",site: "TW" },
      dynamic_parameter_bindings: {},output_bindings: [],required: true,
    }],
  };
}

function result(payload: Record<string, unknown>) {
  return { payload,resultBytes: JSON.stringify(payload).length,isError: false };
}
