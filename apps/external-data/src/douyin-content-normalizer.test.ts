import { describe, expect, it } from "vitest";

import {
  isDouyinContentListPayload,
  normalizeDouyinContentList,
} from "./douyin-content-normalizer.js";
import type { ProviderEndpoint } from "./types.js";

describe("Douyin content-list normalization", () => {
  it("extracts content, publication time, canonical URL and interaction metrics from nested fields", () => {
    const payload = {
      code: 0,
      data: {
        content_list: [{
          id: "7670195638802143930",
          user_info: { name: "通勤包研究员", follower: "7796" },
          attribute_datas: {
            item_title: "轻量通勤双肩包负重实测",
            item_create_time: "1785856587",
            vv_all: "725324",
            interact_cnt: "7244",
            like_cnt_all: "5768",
            comment_cnt_all: "161",
            share_cnt_all: "1315",
          },
        }],
      },
    };
    expect(isDouyinContentListPayload(payload)).toBe(true);
    const normalized = normalizeDouyinContentList(payload, endpoint());
    expect(normalized.records.find((record) => record.providerEntityId === "7670195638802143930")).toMatchObject({
      recordKind: "content",
      titleRaw: "轻量通勤双肩包负重实测",
      authorRaw: "通勤包研究员",
      canonicalUrl: "https://www.douyin.com/video/7670195638802143930",
      publishedAt: "2026-08-04T15:16:27.000Z",
      metrics: {
        views: 725324,
        interactions: 7244,
        likes: 5768,
        comments: 161,
        shares: 1315,
        followers: 7796,
      },
    });
  });
});

function endpoint(): ProviderEndpoint {
  return {
    endpointId: "douyin.hot_search_v1",
    platformId: "douyin",
    platformName: "抖音",
    displayName: "抖音内容检索",
    capability: "关键词与高互动排序",
    apiPath: "/api/provider/content/v1",
    httpMethod: "GET",
    schemaVersion: "test-v1",
    requestSchema: {},
    responseSchema: {},
    requestCodec: {},
    paginationStrategy: {},
    responseFamily: "content",
    normalizerVersion: "generic-json-v1",
    catalogStatus: "active",
    pricingStatus: "priced",
    permissionStatus: "allowed",
    enabled: true,
    documentationUrl: null,
    openapiUrl: null,
  };
}
