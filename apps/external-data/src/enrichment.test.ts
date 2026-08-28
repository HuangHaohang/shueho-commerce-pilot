import { describe, expect, it } from "vitest";

import { enrichCandidates } from "./enrichment.js";
import type { LocalModelClient } from "./local-model-client.js";

describe("AI enrichment promotion", () => {
  it("keeps raw candidates but rejects explicit cross-category contamination", async () => {
    const models = {
      embed: async (texts: string[]) => texts.map(() => new Array(1024).fill(0).map((_, index) => index === 0 ? 1 : 0)),
      rerank: async (_query: string, documents: string[]) => documents.map(() => 0.95),
    } as unknown as LocalModelClient;
    const result = await enrichCandidates({
      requestText: "帮我调研淘宝上蘑菇勺的价格带和销量量级",
      intent: {
        platform: "taobao",
        targetProduct: "蘑菇勺",
        metrics: ["price_band", "sales_level"],
        expectedCategories: ["蘑菇勺"],
        excludedCategories: [],
        currency: "CNY",
        requestedTopN: 50,
        originalRequest: "帮我调研淘宝上蘑菇勺的价格带和销量量级",
      },
      candidates: [
        {
          entityType: "taobao_item",
          entityId: "00000000-0000-4000-8000-000000000001",
          sourceJsonPointer: "/data/model/itemList/0",
          content: "商品标题：厨房不锈钢蘑菇勺；价格：19.9元；销量量级：1000+",
          quality: { status: "valid", reasons: [], normalizedValue: "厨房不锈钢蘑菇勺" },
          supportsPrice: true,
          supportsSales: true,
          metadata: {},
        },
        {
          entityType: "taobao_item",
          entityId: "00000000-0000-4000-8000-000000000002",
          sourceJsonPointer: "/data/model/itemList/1",
          content: "商品标题：RTX4070 高性能游戏笔记本电脑；价格：6999元；销量量级：1000+",
          quality: { status: "valid", reasons: [], normalizedValue: "RTX4070 高性能游戏笔记本电脑" },
          supportsPrice: true,
          supportsSales: true,
          metadata: {},
        },
      ],
      models,
    });
    expect(result.decisions[0]?.decision).toBe("promote");
    expect(result.decisions[1]?.decision).toBe("reject");
    expect(result.decisions[1]?.reasonCodes).toContain("CROSS_CATEGORY_CONTAMINATION");
  });

  it("does not reject a commuter bag merely because it has a laptop compartment", async () => {
    const models = {
      embed: async (texts: string[]) => texts.map(() => new Array(1024).fill(0).map((_, index) => index === 0 ? 1 : 0)),
      rerank: async () => [0.95],
    } as unknown as LocalModelClient;
    const result = await enrichCandidates({
      requestText: "调研轻量通勤双肩包",
      intent: {
        platform: "weixin", targetProduct: "轻量通勤双肩包", metrics: ["market_overview"],
        expectedCategories: ["轻量通勤双肩包"], excludedCategories: [], currency: null,
        requestedTopN: 50, originalRequest: "调研轻量通勤双肩包",
      },
      candidates: [{
        entityType: "generic_record", entityId: "00000000-0000-4000-8000-000000000003",
        sourceJsonPointer: "/data/articles/0", content: "轻量通勤双肩包选购指南；比较重量、容量和电脑夹层",
        quality: { status: "valid", reasons: [], normalizedValue: "轻量通勤双肩包选购指南" },
        supportsPrice: false, supportsSales: false, metadata: {},
      }],
      models,
    });
    expect(result.decisions[0]?.decision).toBe("promote");
    expect(result.decisions[0]?.reasonCodes).not.toContain("CROSS_CATEGORY_CONTAMINATION");
  });

  it("allows multilingual model evidence to establish a cross-language product match", async () => {
    let observedQuery = "";
    const models = {
      embed: async (texts: string[]) => texts.map(() => new Array(1024).fill(0).map((_, index) => index === 0 ? 1 : 0)),
      rerank: async (query: string) => {
        observedQuery = query;
        return [0.92];
      },
    } as unknown as LocalModelClient;
    const result = await enrichCandidates({
      requestText: "帮我调研 Shopee 泰国站的休闲运动裤",
      intent: {
        platform: "shopee", targetProduct: "休闲运动裤", metrics: ["price_band"],
        expectedCategories: ["休闲运动裤"], excludedCategories: [], currency: null,
        requestedTopN: 20, originalRequest: "帮我调研 Shopee 泰国站的休闲运动裤",
      },
      candidates: [{
        entityType: "generic_record", entityId: "00000000-0000-4000-8000-000000000004",
        sourceJsonPointer: "/data/cards/0",
        content: "กางเกงผู้ชายกางเกงกีฬาลำลองผ้าฝ้ายแท้",
        quality: { status: "valid", reasons: [], normalizedValue: "กางเกงผู้ชายกางเกงกีฬาลำลองผ้าฝ้ายแท้" },
        supportsPrice: true, supportsSales: true, metadata: {},
      }],
      models,
    });
    expect(observedQuery).toContain("目标市场当地语言");
    expect(result.decisions[0]?.decision).toBe("promote");
    expect(result.decisions[0]?.reasonCodes).toContain("SEMANTIC_TARGET_MATCH");
  });

  it("uses localized and simplified-traditional query variants before applying model thresholds", async () => {
    const models = {
      embed: async (texts: string[]) => texts.map(() => new Array(1024).fill(0).map((_, index) => index === 0 ? 1 : 0)),
      rerank: async () => [0.1],
    } as unknown as LocalModelClient;
    const result = await enrichCandidates({
      requestText: "调研 Shopee 台湾站的休闲运动裤",
      intent: {
        platform: "shopee",targetProduct: "休闲运动裤",localizedKeyword: "休閒運動褲",
        localizedKeywords: ["休閒運動褲"],metrics: ["price_band"],
        expectedCategories: ["休闲运动裤"],excludedCategories: [],currency: "TWD",
        requestedTopN: 20,originalRequest: "调研 Shopee 台湾站的休闲运动裤",
      },
      candidates: [{
        entityType: "generic_record",entityId: "00000000-0000-4000-8000-000000000005",
        sourceJsonPointer: "/data/cards/0",content: "台灣現貨 美式休閒運動長褲 寬鬆百搭直筒長褲",
        quality: { status: "valid",reasons: [],normalizedValue: "台灣現貨 美式休閒運動長褲" },
        supportsPrice: true,supportsSales: true,metadata: {},
      }],
      models,
    });
    expect(result.decisions[0]?.lexicalScore).toBeGreaterThanOrEqual(0.6);
    expect(result.decisions[0]?.decision).toBe("promote");
    expect(result.decisions[0]?.reasonCodes).not.toContain("TARGET_MISMATCH");
  });

  it("holds valid low-confidence candidates instead of mislabeling them as irrelevant", async () => {
    const models = {
      embed: async (texts: string[]) => texts.map(() => new Array(1024).fill(0).map((_, index) => index === 0 ? 1 : 0)),
      rerank: async () => [0.01],
    } as unknown as LocalModelClient;
    const result = await enrichCandidates({
      requestText: "调研休闲运动裤",
      intent: {
        platform: "shopee",targetProduct: "休闲运动裤",metrics: ["price_band"],
        expectedCategories: ["休闲运动裤"],excludedCategories: [],currency: null,
        requestedTopN: 20,originalRequest: "调研休闲运动裤",
      },
      candidates: [{
        entityType: "generic_record",entityId: "00000000-0000-4000-8000-000000000006",
        sourceJsonPointer: "/data/cards/1",content: "男士日常服饰新品",
        quality: { status: "valid",reasons: [],normalizedValue: "男士日常服饰新品" },
        supportsPrice: true,supportsSales: true,metadata: {},
      }],
      models,
    });
    expect(result.decisions[0]?.decision).toBe("hold");
    expect(result.decisions[0]?.entityMatch).not.toBe("irrelevant");
    expect(result.decisions[0]?.reasonCodes).toContain("INSUFFICIENT_RELEVANCE_EVIDENCE");
  });
});
