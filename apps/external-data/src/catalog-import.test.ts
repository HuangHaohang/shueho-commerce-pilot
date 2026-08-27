import { describe, expect, it } from "vitest";

import { endpointFromOpenApi, mergeCatalog, type DiscoveredOpenApi, type PricingCatalogRow } from "./catalog-import.js";

describe("JustOneAPI catalog import", () => {
  it("builds a callable GET contract only when official pricing allows it", () => {
    const discovered = openapi("/api/search/v1", "get", {
      parameters: [
        parameter("token", true), parameter("keyword", false),
        { name: "sortOrder", in: "query", required: false, schema: { type: "string", enum: ["RELEVANCE", "RECENT"], default: "relevance" } },
        { ...parameter("start", false), description: "开始时间（yyyy-MM-dd HH:mm:ss）" },
        { ...parameter("end", false), description: "结束时间（yyyy-MM-dd HH:mm:ss）" },
        parameter("nextCursor", false),
      ],
    });
    const endpoint = endpointFromOpenApi(discovered, new Map([["/api/search/v1", pricing("search.search_v1", "/api/search/v1")]]));
    expect(endpoint).toMatchObject({
      endpointId: "search.search_v1",
      httpMethod: "GET",
      pricingStatus: "priced",
      enabled: true,
      responseFamily: "social_search_v1",
      requestCodec: { query: ["end", "keyword", "nextCursor", "sortOrder", "start"], transforms: { start: "provider_datetime", end: "provider_datetime" } },
    });
    expect(endpoint.requestSchema).not.toHaveProperty("properties.token");
    expect(endpoint.requestSchema).toHaveProperty("allOf");
    expect(endpoint.requestSchema).toHaveProperty("properties.sortOrder.default", "RELEVANCE");
  });

  it("builds form-urlencoded POST contracts without putting the provider token in the body", () => {
    const discovered = openapi("/api/weixin/search-article/v2", "post", {
      requestBody: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              required: ["token", "keyword"],
              properties: { token: { type: "string" }, keyword: { type: "string" }, page: { type: "integer", default: 1 } },
            },
          },
        },
      },
    });
    const endpoint = endpointFromOpenApi(discovered, new Map([["/api/weixin/search-article/v2", pricing("weixin.search_article_v2", "/api/weixin/search-article/v2")]]));
    expect(endpoint.requestCodec).toMatchObject({
      form: ["keyword", "page"],
      bodyContentType: "application/x-www-form-urlencoded",
    });
    expect(endpoint.requestSchema).toMatchObject({ required: ["keyword"] });
    expect(endpoint.requestSchema).not.toHaveProperty("properties.token");
  });

  it("retains documentation-only and pricing-only endpoints but disables both", () => {
    const documented = openapi("/api/douyin/search-image/v1", "get", { parameters: [parameter("token", true), parameter("keyword", true)] });
    const merged = mergeCatalog({
      openapis: [documented],
      pricingRows: [pricing("jd.price_v1", "/api/jd/price/v1")],
    });
    expect(merged).toHaveLength(2);
    expect(merged.find((endpoint) => endpoint.apiPath.includes("search-image"))).toMatchObject({ pricingStatus: "missing", enabled: false });
    expect(merged.find((endpoint) => endpoint.apiPath.includes("/jd/"))).toMatchObject({ catalogStatus: "missing_openapi", enabled: false });
  });
});

function openapi(path: string, method: "get" | "post", operation: Record<string, unknown>): DiscoveredOpenApi {
  return {
    documentationGroup: path.includes("weixin") ? "wechat-official-accounts" : "social-media",
    documentationUrl: `https://docs.justoneapi.com/zh/api/test/${method}-v1`,
    openapiUrl: `https://docs.justoneapi.com/openapi/test/${method}-v1-zh.json`,
    openapiSha256: "a".repeat(64),
    rawDocument: "{}",
    document: {
      info: { title: "测试接口", description: "测试能力" },
      paths: {
        [path]: {
          [method]: {
            operationId: `${method}Test`,
            responses: {
              "200": { content: { "application/json": { schema: { type: "object" } } } },
            },
            ...operation,
          },
        },
      },
    },
  };
}

function parameter(name: string, required: boolean) {
  return { name, in: "query", required, schema: { type: "string" } };
}

function pricing(endpointId: string, apiPath: string): PricingCatalogRow {
  const platformId = endpointId.split(".")[0] ?? "test";
  return {
    endpointId, platformId, platformName: platformId, apiPath, currency: "CNY",
    vendorUnitCostMicros: 100_000, permissionStatus: "allowed", isActive: true,
  };
}
