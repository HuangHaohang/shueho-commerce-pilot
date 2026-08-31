import { describe, expect, it } from "vitest";

import type { ConversationMessage } from "./use-agent-thread";
import {
  findMatchingConversationMessage,
  mergeAuthoritativeMessages,
} from "./message-reconciliation";

describe("conversation message reconciliation", () => {
  it("replaces an optimistic user bubble with the authoritative Harness message", () => {
    const optimistic: ConversationMessage = {
      id: "user-local",
      sequence: 10,
      turnId: "turn-1",
      role: "user",
      content: "现在能用 web search 了吗",
      clientId: "client-1",
      delivery: "pending",
      status: "completed",
    };
    const authoritative: ConversationMessage = {
      id: "message-harness",
      sequence: 11,
      turnId: "turn-1",
      role: "user",
      content: "现在能用 web search 了吗",
      clientId: "client-1",
      delivery: "committed",
      status: "completed",
    };

    expect(mergeAuthoritativeMessages([optimistic], [authoritative])).toEqual([authoritative]);
  });

  it("preserves optimistic display products when the Harness SSE item commits the user message", () => {
    const optimistic: ConversationMessage = {
      id: "user-local-product",
      sequence: 10,
      turnId: null,
      role: "user",
      content: "基于这个产品生成主图",
      clientId: "client-product-1",
      delivery: "pending",
      products: [{
        id: "33333333-3333-4333-8333-333333333333",
        title: "轻量通勤双肩包",
        spu: "BAG-1001",
        status: "active",
        variantCount: 3,
        sourceName: "Shopify 中国站",
        updatedAt: "2026-08-30T08:00:00.000Z",
        imageUrl: null,
      }],
      status: "completed",
    };
    const authoritative: ConversationMessage = {
      id: "message-harness-product",
      sequence: 11,
      turnId: "turn-product-1",
      role: "user",
      content: "基于这个产品生成主图",
      clientId: "client-product-1",
      delivery: "committed",
      status: "completed",
    };

    expect(mergeAuthoritativeMessages([optimistic], [authoritative])).toEqual([{
      ...authoritative,
      products: optimistic.products,
    }]);
  });

  it("honors an authoritative empty product projection after permission or binding checks", () => {
    const optimistic: ConversationMessage = {
      id: "user-local-product",
      sequence: 10,
      turnId: null,
      role: "user",
      content: "基于这个产品生成主图",
      clientId: "client-product-1",
      delivery: "pending",
      products: [{
        id: "33333333-3333-4333-8333-333333333333",
        title: "轻量通勤双肩包",
        spu: "BAG-1001",
        status: "active",
        variantCount: 3,
        sourceName: "Shopify 中国站",
        updatedAt: "2026-08-30T08:00:00.000Z",
        imageUrl: null,
      }],
      status: "completed",
    };
    const authoritative: ConversationMessage = {
      ...optimistic,
      id: "message-harness-product",
      turnId: "turn-product-1",
      delivery: "committed",
      products: [],
    };

    expect(mergeAuthoritativeMessages([optimistic], [authoritative])).toEqual([authoritative]);
  });

  it("does not collapse distinct repeated prompts without a matching client id", () => {
    const first: ConversationMessage = {
      id: "message-1",
      sequence: 1,
      turnId: "turn-1",
      role: "user",
      content: "测试",
      clientId: "client-1",
      delivery: "committed",
      status: "completed",
    };
    const second: ConversationMessage = {
      ...first,
      id: "message-2",
      sequence: 2,
      turnId: "turn-2",
      clientId: "client-2",
    };

    expect(mergeAuthoritativeMessages([first], [second])).toEqual([first, second]);
  });

  it("collapses duplicate pending bubbles for one authoritative steer client id", () => {
    const first: ConversationMessage = {
      id: "user-local-1",
      sequence: 1,
      turnId: "turn-1",
      role: "user",
      content: "标题改得更克制",
      variant: "steer",
      clientId: "client-steer-1",
      delivery: "pending",
      status: "completed",
    };
    const duplicate: ConversationMessage = {
      ...first,
      id: "user-local-2",
      sequence: 2,
    };
    const authoritative: ConversationMessage = {
      ...first,
      id: "message-harness",
      sequence: 3,
      delivery: "committed",
    };

    expect(mergeAuthoritativeMessages([first, duplicate], [authoritative])).toEqual([
      authoritative,
    ]);
  });

  it("reconciles one commentary message across SSE and thread-read ids", () => {
    const streamed: ConversationMessage = {
      id: "msg-provider-id",
      sequence: 20,
      turnId: "turn-search",
      role: "assistant",
      content: "第一次查询没有返回来源 URL。我缩短关键词后重试。",
      phase: null,
      status: "streaming",
    };
    const authoritative: ConversationMessage = {
      ...streamed,
      id: "item-151",
      sequence: 21,
      phase: "commentary",
      status: "completed",
    };

    expect(mergeAuthoritativeMessages([streamed], [authoritative])).toEqual([authoritative]);
  });

  it("accepts a shorter completed Harness snapshot over a longer local stream", () => {
    const streamed: ConversationMessage = {
      id: "item-1",
      sequence: 1,
      turnId: "turn-1",
      role: "assistant",
      content: "这段本地增量包含了随后被 Harness 修正的尾部",
      phase: "final_answer",
      status: "streaming",
    };
    const authoritative: ConversationMessage = {
      ...streamed,
      content: "这是 Harness 完成后的权威内容。",
      status: "completed",
    };

    expect(mergeAuthoritativeMessages([streamed], [authoritative])).toEqual([authoritative]);
  });

  it("keeps distinct commentary messages from the same turn", () => {
    const first: ConversationMessage = {
      id: "item-1",
      sequence: 1,
      turnId: "turn-search",
      role: "assistant",
      content: "先检查官方页面。",
      phase: "commentary",
      status: "completed",
    };
    const second: ConversationMessage = {
      ...first,
      id: "item-2",
      sequence: 2,
      content: "第一次没有来源，缩短关键词后重试。",
    };

    expect(findMatchingConversationMessage([first], second)).toBeUndefined();
    expect(mergeAuthoritativeMessages([first], [second])).toEqual([first, second]);
  });
});
