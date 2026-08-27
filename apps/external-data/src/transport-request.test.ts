import { describe, expect, it } from "vitest";

import { buildProviderTransportRequest } from "./transport-request.js";
import type { ProviderEndpoint } from "./types.js";

describe("buildProviderTransportRequest", () => {
  it("encodes database-declared GET query parameters without credentials", () => {
    const request = buildProviderTransportRequest(endpoint({ query: ["keyword", "page"], form: [], path: [], header: [], bodyContentType: null }), {
      keyword: "通勤包",
      page: 2,
    });
    expect(request).toMatchObject({
      httpMethod: "GET",
      query: { keyword: "通勤包", page: 2 },
      body: null,
      bodyText: null,
    });
    expect(JSON.stringify(request.requestArtifact)).not.toContain("token");
  });

  it("encodes form POST bodies deterministically", () => {
    const request = buildProviderTransportRequest(endpoint({ query: ["cursor"], form: ["keyword", "limit"], path: [], header: [], bodyContentType: "application/x-www-form-urlencoded" }, "POST"), {
      cursor: "next",
      keyword: "通勤包",
      limit: 20,
    });
    expect(request.query).toEqual({ cursor: "next" });
    expect(request.body).toEqual({ keyword: "通勤包", limit: 20 });
    expect(request.bodyText).toBe("keyword=%E9%80%9A%E5%8B%A4%E5%8C%85&limit=20");
    expect(request.contentType).toBe("application/x-www-form-urlencoded");
    expect(request.requestSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

function endpoint(requestCodec: Record<string, unknown>, method: "GET" | "POST" = "GET"): ProviderEndpoint {
  return {
    endpointId: "test.endpoint_v1", platformId: "test", platformName: "测试",
    displayName: "test", capability: "test", apiPath: "/api/test/endpoint/v1",
    httpMethod: method, schemaVersion: "v1", requestSchema: {}, responseSchema: {},
    requestCodec, paginationStrategy: {}, responseFamily: "generic_json_v1",
    normalizerVersion: "generic-json-v1", catalogStatus: "active", pricingStatus: "priced",
    permissionStatus: "allowed",
    enabled: true,
    documentationUrl: null,
    openapiUrl: null,
  };
}
