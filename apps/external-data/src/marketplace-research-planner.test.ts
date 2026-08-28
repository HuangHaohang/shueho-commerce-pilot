import { describe, expect, it } from "vitest";

import { selectMarketplaceProductResearchPlan } from "./marketplace-research-planner.js";
import type { ProviderBusinessWorkflow } from "./business-workflows.js";
import { buildProviderMarketOptions } from "./market-options.js";
import type { ProviderEndpoint } from "./types.js";

describe("marketplace product research planning", () => {
  it("materializes the discovery step and keeps downstream identifiers as private bindings", () => {
    const plan = selectMarketplaceProductResearchPlan([workflow()], {
      platform: "TAOBAO",
      keyword: "蘑菇勺",
      localizedKeyword: null,
      market: null,
      tmallOnly: false,
      minPriceYuan: 10,
      maxPriceYuan: 100,
      requestedMetrics: ["price_band", "sales_level", "brand_competition", "property_distribution"],
      maxResults: 50,
    });
    expect(plan.workflow.workflowId).toBe("taobao.products_by_keyword_v1");
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]?.parameterTemplate).toMatchObject({
      keyword: "蘑菇勺",
      sort: "_sale",
      tmall: false,
      startPrice: "10",
      endPrice: "100",
      page: 1,
    });
    expect(plan.steps[1]?.dynamicParameterBindings).toEqual({ itemId: "item_id" });
    expect(plan.coverage.provider_calls_planned).toBe(7);
    expect(plan.coverage.detailed_products_planned).toBe(3);
  });

  it("requires a Shopee site before any provider plan is produced", () => {
    expect(() => selectMarketplaceProductResearchPlan([shopeeWorkflow()], {
      platform: "SHOPEE",
      keyword: "通勤包",
      localizedKeyword: null,
      market: null,
      tmallOnly: false,
      minPriceYuan: null,
      maxPriceYuan: null,
      requestedMetrics: ["price_band"],
      maxResults: 20,
    })).toThrowError(expect.objectContaining({
      code: "MARKET_SELECTION_REQUIRED",
      message: expect.stringContaining("TW"),
    }));
  });

  it("rejects an unsupported Shopee site and accepts a supported one", () => {
    expect(() => selectMarketplaceProductResearchPlan([shopeeWorkflow()], {
      platform: "SHOPEE",
      keyword: "通勤包",
      localizedKeyword: null,
      market: "SG",
      tmallOnly: false,
      minPriceYuan: null,
      maxPriceYuan: null,
      requestedMetrics: ["price_band"],
      maxResults: 20,
    })).toThrowError(expect.objectContaining({ code: "MARKET_UNSUPPORTED" }));
    const plan = selectMarketplaceProductResearchPlan([shopeeWorkflow()], {
      platform: "SHOPEE",
      keyword: "通勤包",
      localizedKeyword: "通勤後背包",
      market: "TW",
      tmallOnly: false,
      minPriceYuan: null,
      maxPriceYuan: null,
      requestedMetrics: ["price_band"],
      maxResults: 20,
    });
    expect(plan.steps[0]?.parameterTemplate).toMatchObject({ site: "TW", keyword: "通勤後背包" });
  });

  it("requires an Agent-generated local-market keyword after site selection", () => {
    expect(() => selectMarketplaceProductResearchPlan([shopeeWorkflow()], {
      platform: "SHOPEE",
      keyword: "休闲运动裤",
      localizedKeyword: null,
      market: "TH",
      tmallOnly: false,
      minPriceYuan: null,
      maxPriceYuan: null,
      requestedMetrics: ["price_band"],
      maxResults: 20,
    })).toThrowError(expect.objectContaining({ code: "LOCALIZED_KEYWORD_REQUIRED" }));
  });

  it("rejects a localized keyword that does not use the selected market script", () => {
    expect(() => selectMarketplaceProductResearchPlan([shopeeWorkflow()], {
      platform: "SHOPEE",
      keyword: "休闲运动裤",
      localizedKeyword: "休闲运动裤",
      market: "TH",
      tmallOnly: false,
      minPriceYuan: null,
      maxPriceYuan: null,
      requestedMetrics: ["price_band"],
      maxResults: 20,
    })).toThrowError(expect.objectContaining({ code: "LOCALIZED_KEYWORD_INVALID" }));
  });
});

function workflow(): ProviderBusinessWorkflow {
  const search = endpoint();
  const detail = itemEndpoint("taobao.get_item_detail_v9");
  const reviews = itemEndpoint("taobao.get_item_comment_v3");
  return {
    workflowId: "taobao.products_by_keyword_v1",
    businessTool: "research_marketplace_products",
    platformId: "taobao",
    displayName: "淘宝关键词商品详情",
    capability: "关键词搜索后读取详情与评价",
    workflowVersion: "1.0.0",
    inputSchema: {},
    maximumProviderCalls: 3,
    definitionSha256: "a".repeat(64),
    sourceCatalogImportId: "00000000-0000-4000-8000-000000000001",
    marketOptions: [],
    steps: [
      {
        stepId: "discover",
        stepOrder: 0,
        role: "discovery",
        endpoint: search,
        inputBindings: {
          keyword: { source: "business_input", key: "keyword" },
          tmall: { source: "business_input", key: "tmall_only" },
          startPrice: { source: "business_input", key: "min_price_yuan", omit_if_null: true },
          endPrice: { source: "business_input", key: "max_price_yuan", omit_if_null: true },
        },
        outputBindings: [{ name: "item_id", aliases: ["itemId"], value_type: "string" }],
        required: true,
      },
      {
        stepId: "detail",
        stepOrder: 1,
        role: "detail",
        endpoint: detail,
        inputBindings: { itemId: { source: "resolved_binding", key: "item_id" } },
        outputBindings: [],
        required: true,
      },
      {
        stepId: "reviews",
        stepOrder: 2,
        role: "reviews",
        endpoint: reviews,
        inputBindings: { itemId: { source: "resolved_binding", key: "item_id" } },
        outputBindings: [],
        required: true,
      },
    ],
  };
}

function endpoint(): ProviderEndpoint {
  return {
    endpointId: "taobao.search_item_list_v1",
    platformId: "taobao",
    platformName: "淘宝和天猫",
    displayName: "商品搜索",
    capability: "搜索商品",
    apiPath: "/api/marketplace/products/v1",
    httpMethod: "GET",
    schemaVersion: "test-v1",
    requestSchema: {
      type: "object",
      additionalProperties: false,
      required: ["keyword"],
      properties: {
        page: { type: "integer", default: 1 },
        keyword: { type: "string" },
        sort: { type: "string", enum: ["_sale", "_coefp"], default: "_sale" },
        tmall: { type: "boolean", default: false },
        startPrice: { type: "string" },
        endPrice: { type: "string" },
      },
    },
    responseSchema: {},
    requestCodec: {},
    paginationStrategy: {},
    responseFamily: "taobao_search_item_list_v1",
    normalizerVersion: "1.0.0",
    catalogStatus: "active",
    pricingStatus: "priced",
    permissionStatus: "allowed",
    enabled: true,
    documentationUrl: null,
    openapiUrl: null,
  };
}

function itemEndpoint(endpointId: string): ProviderEndpoint {
  return {
    ...endpoint(),
    endpointId,
    responseFamily: "commerce_product",
    requestSchema: {
      type: "object",
      additionalProperties: false,
      required: ["itemId"],
      properties: { itemId: { type: "string" } },
    },
  };
}

function shopeeWorkflow(): ProviderBusinessWorkflow {
  const search = {
    ...endpoint(),
    endpointId: "shopee.search_item_list_v1",
    platformId: "shopee",
    requestSchema: {
      type: "object",
      additionalProperties: false,
      required: ["keyword", "site"],
      properties: {
        keyword: { type: "string" },
        site: { type: "string", enum: ["TW", "ID", "TH"] },
      },
    },
  };
  return {
    workflowId: "shopee.products_by_keyword_v1",
    businessTool: "research_marketplace_products",
    platformId: "shopee",
    displayName: "Shopee关键词商品详情",
    capability: "Shopee 商品研究",
    workflowVersion: "1.0.0",
    inputSchema: {},
    maximumProviderCalls: 1,
    definitionSha256: "b".repeat(64),
    sourceCatalogImportId: "00000000-0000-4000-8000-000000000001",
    marketOptions: buildProviderMarketOptions([search]).map((option) => ({
      code: option.marketCode,
      displayName: option.displayName,
      profileId: `00000000-0000-4000-8000-00000000000${option.sortOrder + 2}`,
      profileRevision: "c".repeat(64),
      preferredQueryLocale: option.marketCode === "TW" ? "zh-Hant-TW" : option.marketCode === "TH" ? "th-TH" : "id-ID",
      queryLocales: [option.marketCode === "TW" ? "zh-Hant-TW" : option.marketCode === "TH" ? "th-TH" : "id-ID"],
      acceptedQueryLanguages: [option.marketCode === "TW" ? "zh" : option.marketCode === "TH" ? "th" : "id"],
      timezone: option.marketCode === "TW" ? "Asia/Taipei" : option.marketCode === "TH" ? "Asia/Bangkok" : "Asia/Jakarta",
      currency: option.marketCode === "TW" ? "TWD" : option.marketCode === "TH" ? "THB" : "IDR",
      keywordLocalizationPolicy: "agent_generated_validated" as const,
      expectedScripts: [option.marketCode === "TW" ? "Hant" : option.marketCode === "TH" ? "Thai" : "Latn"],
      qualityPolicy: { detailSampleSize: 3, maxDetailSampleSize: 5 },
    })),
    steps: [{
      stepId: "discover",
      stepOrder: 0,
      role: "discovery",
      endpoint: search,
      inputBindings: {
        keyword: { source: "business_input", key: "effective_keyword" },
        site: { source: "business_input", key: "market" },
      },
      outputBindings: [],
      required: true,
    }],
  };
}
