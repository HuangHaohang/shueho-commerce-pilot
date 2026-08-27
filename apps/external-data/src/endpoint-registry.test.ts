import { describe, expect, it } from "vitest";

import { validateEndpointParams } from "./endpoint-registry.js";
import type { ProviderEndpoint } from "./types.js";

const endpoint: ProviderEndpoint = {
  endpointId: "taobao.search_item_list_v1",
  platformId: "taobao",
  platformName: "淘宝和天猫",
  displayName: "淘宝商品搜索",
  capability: "商品搜索",
  apiPath: "/api/taobao/search-item-list/v1",
  httpMethod: "GET",
  schemaVersion: "v1",
  requestSchema: {
    type: "object", additionalProperties: false, required: ["keyword"],
    properties: {
      keyword: { type: "string", minLength: 1, maxLength: 200 },
      sort: { type: "string", enum: ["_sale", "_bid", "bid", "_coefp"], default: "_sale" },
      tmall: { type: "boolean", default: false },
      page: { type: "integer", minimum: 1, default: 1 },
    },
  },
  responseSchema: {},
  requestCodec: { query: ["keyword", "sort", "tmall", "page"], form: [], path: [], header: [] },
  paginationStrategy: { requestKeys: ["page"] },
  responseFamily: "taobao_search_item_list_v1",
  normalizerVersion: "1.0.0",
  catalogStatus: "active",
  pricingStatus: "priced",
  permissionStatus: "allowed",
  enabled: true,
  documentationUrl: null,
  openapiUrl: null,
};

describe("provider parameter validation", () => {
  it("materializes documented defaults only", () => {
    expect(validateEndpointParams(endpoint, { keyword: " 蘑菇勺 " })).toEqual({
      keyword: "蘑菇勺",
      sort: "_sale",
      tmall: false,
      page: 1,
    });
  });

  it("rejects credentials and undocumented filters", () => {
    expect(() => validateEndpointParams(endpoint, { keyword: "蘑菇勺", token: "secret" })).toThrow(/credentials/);
    expect(() => validateEndpointParams(endpoint, { keyword: "蘑菇勺", magicFilter: true })).toThrow(/official OpenAPI schema/);
  });

  it("normalizes provider date ranges before OpenAPI validation", () => {
    const searchEndpoint: ProviderEndpoint = {
      ...endpoint,
      endpointId: "search.search_v1",
      platformId: "search",
      platformName: "跨平台搜索",
      requestSchema: {
        type: "object", additionalProperties: false, required: ["start", "end"],
        properties: {
          start: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$" },
          end: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$" },
          source: { type: "string", default: "ALL" },
        },
      },
      requestCodec: {
        query: ["start", "end"], form: [], path: [], header: [],
        transforms: { start: "provider_datetime", end: "provider_datetime" },
      },
    };
    expect(validateEndpointParams(searchEndpoint, { start: "2026-08-21", end: "2026-08-27" })).toEqual({
      start: "2026-08-21 00:00:00",
      end: "2026-08-27 23:59:59",
      source: "ALL",
    });
  });
});
