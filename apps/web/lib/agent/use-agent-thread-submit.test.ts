import { describe, expect, it } from "vitest";

import {
  buildAgentTurnRequestBody,
  findRetrySourceMessage,
  isPersistedQueuedTurnResponse,
  readUserMessageSkillName,
} from "./use-agent-thread";

describe("agent Turn request body", () => {
  it("forwards only the allowlisted creative method identifier", () => {
    expect(buildAgentTurnRequestBody({
      message: "为这款产品生成主图",
      model: "gpt-5.6-luna",
      effort: "medium",
      options: {
        workflow: "commerce-creative-project",
        creativeMethod: "main_image",
        productIds: ["33333333-3333-4333-8333-333333333333"],
        productContextMode: "selected",
        displayProducts: [{
          id: "33333333-3333-4333-8333-333333333333",
          title: "轻量通勤双肩包",
          spu: "BAG-1001",
          status: "active",
          variantCount: 3,
          sourceName: "Shopify 中国站",
          updatedAt: "2026-08-30T08:00:00.000Z",
          imageUrl: null,
        }],
      },
      attachmentIds: ["44444444-4444-4444-8444-444444444444"],
      clientRequestId: "55555555-5555-4555-8555-555555555555",
    })).toEqual({
      message: "为这款产品生成主图",
      model: "gpt-5.6-luna",
      effort: "medium",
      workflow: "commerce-creative-project",
      creativeMethod: "main_image",
      insightMethod: undefined,
      skillName: undefined,
      attachmentIds: ["44444444-4444-4444-8444-444444444444"],
      externalDataApprovalMode: "always_ask",
      productIds: ["33333333-3333-4333-8333-333333333333"],
      productContextMode: "selected",
      clientRequestId: "55555555-5555-4555-8555-555555555555",
    });
  });

  it("keeps display products out of the BFF Turn request contract", () => {
    const body = buildAgentTurnRequestBody({
      message: "基于这个产品生成主图",
      model: "gpt-5.6-luna",
      options: {
        productIds: ["33333333-3333-4333-8333-333333333333"],
        productContextMode: "selected",
        displayProducts: [{
          id: "33333333-3333-4333-8333-333333333333",
          title: "轻量通勤双肩包",
          spu: "BAG-1001",
          status: "active",
          variantCount: 3,
          sourceName: "Shopify 中国站",
          updatedAt: "2026-08-30T08:00:00.000Z",
          imageUrl: null,
        }],
        onTurnAccepted: () => undefined,
      },
      attachmentIds: [],
      clientRequestId: "55555555-5555-4555-8555-555555555555",
    });

    expect(body).not.toHaveProperty("displayProducts");
    expect(body).not.toHaveProperty("onTurnAccepted");
    expect(body.productIds).toEqual(["33333333-3333-4333-8333-333333333333"]);
  });

  it("does not invent a specialist method for an ordinary Turn", () => {
    expect(buildAgentTurnRequestBody({
      message: "继续分析",
      model: "gpt-5.6-luna",
      effort: "low",
      attachmentIds: [],
      clientRequestId: "66666666-6666-4666-8666-666666666666",
    }).creativeMethod).toBeUndefined();
  });

  it("treats only a durable 202 queue receipt as an accepted queued submission", () => {
    expect(isPersistedQueuedTurnResponse(202, { queued: true })).toBe(true);
    expect(isPersistedQueuedTurnResponse(202, { queued: false })).toBe(false);
    expect(isPersistedQueuedTurnResponse(500, { queued: true })).toBe(false);
    expect(isPersistedQueuedTurnResponse(202, null)).toBe(false);
  });

  it("forwards only the allowlisted product insight method instead of Skill instructions", () => {
    const body = buildAgentTurnRequestBody({
      message: "复盘这款砂锅",
      model: "gpt-5.6-luna",
      options: {
        workflow: "commerce-product-insight",
        insightMethod: "product_retrospective",
        productIds: ["33333333-3333-4333-8333-333333333333"],
        productContextMode: "selected",
      },
      attachmentIds: [],
      clientRequestId: "66666666-6666-4666-8666-666666666666",
    });
    expect(body.insightMethod).toBe("product_retrospective");
    expect(body).not.toHaveProperty("skillBody");
    expect(body).not.toHaveProperty("outputSchema");
  });

  it("uses the final native Skill as the visible specialist label", () => {
    expect(readUserMessageSkillName({
      content: [
        { type: "text", text: "生成一张主图" },
        { type: "skill", name: "commerce-creative-project", path: "hidden-base-path" },
        { type: "skill", name: "commerce-product-main-image", path: "hidden-method-path" },
      ],
    })).toBe("commerce-product-main-image");
    expect(readUserMessageSkillName({
      content: [{ type: "skill", name: "commerce-copywriting", path: "hidden-path" }],
    })).toBe("commerce-copywriting");
  });
});

describe("assistant reply retry source", () => {
  it("uses the initial authoritative user message that started the reply's Harness Turn", () => {
    const source = findRetrySourceMessage([
      {
        id: "user-original",
        sequence: 1,
        turnId: "turn-retry-1",
        role: "user",
        content: "生成商品主图",
        status: "completed",
      },
      {
        id: "user-reference",
        sequence: 2,
        turnId: "turn-retry-1",
        role: "user",
        content: "这个就是我的产品",
        attachments: [{
          id: "44444444-4444-4444-8444-444444444444",
          name: "product.jpg",
          mimeType: "image/jpeg",
          size: 128,
          kind: "image",
          url: "/api/agent/attachments/product.jpg",
        }],
        status: "completed",
      },
      {
        id: "agent-final",
        sequence: 3,
        turnId: "turn-retry-1",
        role: "assistant",
        content: "图片未生成",
        phase: "final_answer",
        status: "completed",
      },
    ], {
      id: "agent-final",
      sequence: 3,
      turnId: "turn-retry-1",
      role: "assistant",
      content: "图片未生成",
      phase: "final_answer",
      status: "completed",
    });

    expect(source?.id).toBe("user-original");
  });
});
