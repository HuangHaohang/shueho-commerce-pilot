import { describe, expect, it } from "vitest";

import { normalizeWithRegistry, registeredNormalizerFamily } from "./normalizer-registry.js";
import type { ProviderEndpoint } from "./types.js";

describe("NormalizerRegistry", () => {
  it("keeps specialized contracts and routes all other endpoint families to generic JSON", () => {
    expect(registeredNormalizerFamily(endpoint("taobao_search_item_list_v1"))).toBe("taobao_search_item_list_v1");
    expect(registeredNormalizerFamily(endpoint("content"))).toBe("generic_json_v1");
    expect(normalizeWithRegistry(endpoint("content"), { code: 0, data: { videos: [{ id: "1", title: "通勤包" }] } }).kind).toBe("generic");
  });
});

function endpoint(responseFamily: string): ProviderEndpoint {
  return {
    endpointId: "test.endpoint_v1", platformId: "test", platformName: "测试",
    displayName: "test", capability: "test", apiPath: "/api/test/endpoint/v1",
    httpMethod: "GET", schemaVersion: "v1", requestSchema: {}, responseSchema: {},
    requestCodec: {}, paginationStrategy: {}, responseFamily, normalizerVersion: "1.0.0",
    catalogStatus: "active", pricingStatus: "priced", permissionStatus: "allowed", enabled: true,
    documentationUrl: null, openapiUrl: null,
  };
}
