import { describe, expect, it } from "vitest";

import type {
  ConversationMessage,
  GeneratedImageItem,
} from "@/lib/agent/use-agent-thread";

import {
  listCreativeCanvasDeliveries,
  selectLatestCreativeCanvasDelivery,
} from "./creative-canvas";

function assistantMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: "message-1",
    sequence: 1,
    turnId: "turn-1",
    role: "assistant",
    content: "第一版商品文案",
    phase: "final_answer",
    status: "completed",
    ...overrides,
  };
}

function generatedImage(
  overrides: Partial<GeneratedImageItem> = {},
): GeneratedImageItem {
  return {
    id: "image-1",
    sequence: 2,
    turnId: "turn-1",
    url: "/api/provider/generated-images/image-1.png",
    filename: "image-1.png",
    model: "gpt-image-2",
    ...overrides,
  };
}

function structuredDraft(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    responseType: "draft",
    deliverableType: "listing_copy",
    channel: "天猫",
    title: "轻装出发",
    body: "为日常通勤减去负担。",
    callToAction: "现在探索",
    complianceNotes: [],
    message: "",
    ...overrides,
  });
}

describe("creative canvas projection", () => {
  it("returns null for a truly empty canvas", () => {
    expect(selectLatestCreativeCanvasDelivery([], [])).toBeNull();
  });

  it("ignores user messages, commentary, and streaming assistant output", () => {
    const messages: ConversationMessage[] = [
      assistantMessage({ id: "user", role: "user", content: "修改标题" }),
      assistantMessage({ id: "commentary", phase: "commentary" }),
      assistantMessage({ id: "streaming", status: "streaming" }),
    ];

    expect(selectLatestCreativeCanvasDelivery(messages, [])).toBeNull();
  });

  it("keeps the prior asset when a later structured response is conversational only", () => {
    const messages: ConversationMessage[] = [
      assistantMessage({ sequence: 4, content: "第一版商品文案" }),
      assistantMessage({
        id: "answer-1",
        sequence: 5,
        turnId: "turn-2",
        content: JSON.stringify({ responseType: "answer", message: "可以，我会保留原来的语气。" }),
      }),
    ];

    expect(selectLatestCreativeCanvasDelivery(messages, [])).toMatchObject({
      kind: "document",
      id: "message-1",
      content: "第一版商品文案",
      ordinal: 1,
    });
  });

  it("parses the managed deliverable type and channel without inventing a separate canvas record", () => {
    expect(
      selectLatestCreativeCanvasDelivery(
        [assistantMessage({ content: structuredDraft() })],
        [],
      ),
    ).toMatchObject({
      kind: "document",
      deliverableType: "listing_copy",
      channel: "天猫",
      ordinal: 1,
      total: 1,
      draft: {
        title: "轻装出发",
        body: "为日常通勤减去负担。",
      },
    });
  });

  it("groups every native image from one Turn and merges its companion draft", () => {
    const deliveries = listCreativeCanvasDeliveries(
      [assistantMessage({
        sequence: 12,
        turnId: "turn-image",
        content: structuredDraft({ deliverableType: "gallery_images", channel: "京东" }),
      })],
      [
        generatedImage({ id: "image-a", sequence: 10, turnId: "turn-image" }),
        generatedImage({ id: "image-b", sequence: 11, turnId: "turn-image", url: "/image-b.png" }),
      ],
    );

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      kind: "imageGroup",
      deliverableType: "gallery_images",
      channel: "京东",
      sequence: 12,
      ordinal: 1,
      images: [{ id: "image-a" }, { id: "image-b" }],
      companion: { id: "message-1" },
    });
  });

  it("numbers persisted Harness deliveries in sequence order", () => {
    const deliveries = listCreativeCanvasDeliveries(
      [
        assistantMessage({ id: "copy", sequence: 3, turnId: "turn-copy", content: structuredDraft() }),
        assistantMessage({
          id: "script",
          sequence: 8,
          turnId: "turn-script",
          content: structuredDraft({ deliverableType: "shooting_script", channel: "抖音电商" }),
        }),
      ],
      [generatedImage({ sequence: 6, turnId: "turn-image" })],
    );

    expect(deliveries.map((delivery) => [delivery.kind, delivery.ordinal, delivery.total])).toEqual([
      ["document", 1, 3],
      ["imageGroup", 2, 3],
      ["document", 3, 3],
    ]);
    expect(selectLatestCreativeCanvasDelivery(
      [assistantMessage({ id: "script", sequence: 8, turnId: "turn-script", content: structuredDraft({ deliverableType: "shooting_script" }) })],
      [generatedImage({ sequence: 6, turnId: "turn-image" })],
    )).toMatchObject({ kind: "document", deliverableType: "shooting_script", ordinal: 2 });
  });
});
