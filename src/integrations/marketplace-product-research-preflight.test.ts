import assert from "node:assert/strict";
import test from "node:test";

import {
  MarketplaceProductResearchPreflightError,
  preflightMarketplaceProductResearch,
} from "./marketplace-product-research-preflight.js";

test("returns a policy-constrained marketplace plan before reservation", async () => {
  const result = await preflightMarketplaceProductResearch({
    preflightMarketplaceProductResearch: async (args) => ({
      payload: {
        success: true,
        business_tool: "research_marketplace_products",
        workflow_id: "taobao.products_by_keyword_v1",
        workflow_version: "1.0.0",
        research_plan_key: "b".repeat(64),
        business_input: { keyword: args.keyword },
        business_intent: { kind: "marketplace_product_research" },
        coverage: { requested_metrics: ["price_band", "sales_level"] },
        steps: [{
          step_id: "discover",
          step_order: 0,
          role: "discovery",
          endpoint_id: "taobao.search_item_list_v1",
          platform: "taobao",
          parameter_template: { keyword: args.keyword, sort: "_sale", page: 1 },
          dynamic_parameter_bindings: {},
          output_bindings: [{ name: "item_id", aliases: ["itemId"], value_type: "string" }],
          required: true,
        }],
      },
      resultBytes: 1,
      isError: false,
    }),
  }, {
    platform: "TAOBAO",
    keyword: "蘑菇勺",
    localized_keyword: null,
    market: null,
    tmall_only: false,
    min_price_yuan: null,
    max_price_yuan: null,
    requested_metrics: ["price_band", "sales_level"],
    max_results: 50,
  }, {
    allowedPlatforms: ["taobao"],
    allowedEndpointIds: ["taobao.search_item_list_v1"],
  });
  assert.equal(result.workflowId, "taobao.products_by_keyword_v1");
  assert.equal(result.steps[0]?.endpointId, "taobao.search_item_list_v1");
});

test("preserves a database-backed market selection failure before reservation", async () => {
  await assert.rejects(
    () => preflightMarketplaceProductResearch({
      preflightMarketplaceProductResearch: async () => ({
        payload: {
          success: false,
          code: "MARKET_SELECTION_REQUIRED",
          message: "Shopee需要先选择市场站点。",
          details: { supportedMarkets: [{ code: "TW", label: "database label" }] },
        },
        resultBytes: 1,
        isError: false,
      }),
    }, {
      platform: "SHOPEE",
      keyword: "通勤包",
      localized_keyword: null,
      market: null,
      tmall_only: false,
      min_price_yuan: null,
      max_price_yuan: null,
      requested_metrics: ["price_band"],
      max_results: 20,
    }),
    (error: unknown) => error instanceof MarketplaceProductResearchPreflightError &&
      error.code === "MARKET_SELECTION_REQUIRED" && Array.isArray(error.details.supportedMarkets),
  );
});
