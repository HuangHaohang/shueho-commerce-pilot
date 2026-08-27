import { describe, expect, it } from "vitest";

import { buildProviderMarketOptions } from "./market-options.js";
import type { ProviderEndpoint } from "./types.js";

describe("provider market option catalog", () => {
  it("derives marketplace options from OpenAPI enums instead of runtime constants", () => {
    const options = buildProviderMarketOptions([endpoint()]);
    expect(options.map((option) => option.marketCode)).toEqual(["TW", "ID", "TH"]);
    expect(options.map((option) => option.sortOrder)).toEqual([0, 1, 2]);
    expect(options.every((option) => option.displayName.endsWith("站"))).toBe(true);
    expect(options.every((option) => option.endpointId === "shopee.search_item_list_v1")).toBe(true);
  });
});

function endpoint(): ProviderEndpoint {
  return {
    endpointId: "shopee.search_item_list_v1",
    platformId: "shopee",
    platformName: "Shopee",
    displayName: "Shopee商品搜索",
    capability: "搜索商品",
    apiPath: "/api/shopee/search-item-list/v1",
    httpMethod: "GET",
    schemaVersion: "test-v1",
    requestSchema: {
      type: "object",
      required: ["keyword", "site"],
      properties: {
        keyword: { type: "string" },
        site: { type: "string", enum: ["TW", "ID", "TH"] },
      },
    },
    responseSchema: {},
    requestCodec: {},
    paginationStrategy: {},
    responseFamily: "commerce_product",
    normalizerVersion: "generic-json-v1",
    catalogStatus: "active",
    pricingStatus: "priced",
    permissionStatus: "allowed",
    enabled: true,
    documentationUrl: null,
    openapiUrl: null,
  };
}
