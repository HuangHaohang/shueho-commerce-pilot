import { describe, expect, it } from "vitest";

import { normalizeGenericPayload, shouldEnrichGenericRecord } from "./generic-normalizer.js";
import type { ProviderEndpoint } from "./types.js";

describe("normalizeGenericPayload", () => {
  it("retains every returned collection and item while producing bounded candidates", () => {
    const normalized = normalizeGenericPayload({
      code: 0,
      data: {
        videos: [
          { aweme_id: "v1", title: "轻量通勤双肩包测评", stats: { like_count: 1200 }, tags: ["通勤", "双肩包"] },
          { aweme_id: "v2", title: "电脑评测" },
        ],
        cursor: 99,
      },
    }, endpoint());
    expect(normalized.collections.map((collection) => collection.jsonPointer)).toEqual([
      "/data/videos",
      "/data/videos/0/tags",
    ]);
    expect(normalized.records).toHaveLength(5);
    expect(normalized.records.find((record) => record.providerEntityId === "v1")).toMatchObject({
      recordKind: "content",
      titleRaw: "轻量通勤双肩包测评",
      metrics: { stats: { like_count: 1200 } },
    });
    expect(normalized.records.some((record) => record.jsonPointer === "/data/videos/0/tags/1" && record.rawData === "双肩包")).toBe(true);
  });

  it("does not treat oversized JD filter metadata as a provider entity id", () => {
    const normalized = normalizeGenericPayload({
      code: 0,
      data: {
        wareList: [{ id: "100085743422", wareid: "100085743422", name: "砂锅", commentData: { count: 10 } }],
        commonData: { filterData: { brand: { id: "1".repeat(3_586) } } },
      },
    }, { ...endpoint(), endpointId: "jd.search_item_list_v2", platformId: "jd", responseFamily: "commerce_product" });
    expect(normalized.records.find((record) => record.jsonPointer === "/data/wareList/0")?.providerEntityId)
      .toBe("100085743422");
    expect(normalized.records.find((record) => record.jsonPointer === "/data/wareList/0")?.recordKind)
      .toBe("product");
    expect(normalized.records.every((record) => record.providerEntityId === null || record.providerEntityId.length <= 255))
      .toBe(true);
  });

  it("normalizes Shopee display prices and localized sold counts without inventing CNY values", () => {
    const endpointValue = {
      ...endpoint(),
      endpointId: "shopee.search_item_list_v1",
      platformId: "shopee",
      platformName: "Shopee",
      responseFamily: "commerce_product",
    };
    const normalized = normalizeGenericPayload({
      code: 0,
      data: {
        cards: [{
          item_id: 44257621800,
          shop_id: 848740789,
          title: "กางเกงกีฬาลำลองผู้หญิง",
          currency: "THB",
          display_price: 199,
          price_texts: ["฿ 199", "฿ 370"],
          sold_text: "ขายแล้ว 1.2พัน ชิ้น",
          image_url: "https://down-th.img.susercontent.com/file/example",
        }],
      },
    }, endpointValue);
    const product = normalized.records.find((record) => record.jsonPointer === "/data/cards/0");
    expect(product).toMatchObject({
      recordKind: "product",
      providerEntityId: "44257621800",
      metrics: {
        price_amount: 199,
        currency: "THB",
        price_texts: ["฿ 199", "฿ 370"],
        price_display: "฿ 199",
        sales_display: "ขายแล้ว 1.2พัน ชิ้น",
        sales_lower_bound: 1200,
        sales_qualifier: "gte",
        image_url: "https://down-th.img.susercontent.com/file/example",
      },
    });
    expect(product?.metrics).not.toHaveProperty("price_yuan");
    expect(product && shouldEnrichGenericRecord(product, endpointValue.responseFamily)).toBe(true);

    const priceText = normalized.records.find((record) => record.jsonPointer === "/data/cards/0/price_texts/0");
    expect(priceText).toMatchObject({ recordKind: "metric", rawData: "฿ 199" });
    expect(priceText && shouldEnrichGenericRecord(priceText, endpointValue.responseFamily)).toBe(false);
  });
});

function endpoint(): ProviderEndpoint {
  return {
    endpointId: "douyin.search_video_v4", platformId: "douyin", platformName: "抖音",
    displayName: "视频搜索", capability: "搜索视频", apiPath: "/api/douyin/search-video/v4",
    httpMethod: "GET", schemaVersion: "v1", requestSchema: {}, responseSchema: {},
    requestCodec: {}, paginationStrategy: {}, responseFamily: "content", normalizerVersion: "generic-json-v1",
    catalogStatus: "active", pricingStatus: "priced", permissionStatus: "allowed",
    enabled: true,
    documentationUrl: null, openapiUrl: null,
  };
}
