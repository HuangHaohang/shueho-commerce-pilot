import { describe, expect, it } from "vitest";

import { buildCuratedMarketplaceWorkflows } from "./business-workflows.js";
import type { ProviderEndpoint } from "./types.js";

describe("provider business workflow catalog", () => {
  it("builds the JD keyword to detail and price chain only when every endpoint is callable", () => {
    const workflows = buildCuratedMarketplaceWorkflows([
      endpoint("jd.search_item_list_v2", { keyword: { type: "string" }, page: { type: "string" } }, ["keyword"]),
      endpoint("jd.get_item_detail_v3", { itemId: { type: "string" } }, ["itemId"]),
      endpoint("jd.get_item_price_v1", { itemId: { type: "string" } }, ["itemId"]),
    ]);
    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.workflowId).toBe("jd.products_by_keyword_v1");
    expect(workflows[0]?.steps.map((step) => [step.role, step.endpointId])).toEqual([
      ["discovery", "jd.search_item_list_v2"],
      ["detail", "jd.get_item_detail_v3"],
      ["price", "jd.get_item_price_v1"],
    ]);
    expect(workflows[0]?.steps[0]?.outputBindings[0]?.aliases).toContain("skuId");
  });

  it("does not publish a partial chain when one paid downstream endpoint is disabled", () => {
    const workflows = buildCuratedMarketplaceWorkflows([
      endpoint("jd.search_item_list_v2", { keyword: { type: "string" } }, ["keyword"]),
      endpoint("jd.get_item_detail_v3", { itemId: { type: "string" } }, ["itemId"]),
      { ...endpoint("jd.get_item_price_v1", { itemId: { type: "string" } }, ["itemId"]), enabled: false },
    ]);
    expect(workflows).toEqual([]);
  });
});

function endpoint(
  endpointId: string,
  properties: Record<string, unknown>,
  required: string[],
): ProviderEndpoint {
  return {
    endpointId,
    platformId: "jd",
    platformName: "京东",
    displayName: endpointId,
    capability: endpointId,
    apiPath: `/api/jd/${endpointId.split(".")[1]}`,
    httpMethod: "GET",
    schemaVersion: "test-v1",
    requestSchema: { type: "object", additionalProperties: false, required, properties },
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
