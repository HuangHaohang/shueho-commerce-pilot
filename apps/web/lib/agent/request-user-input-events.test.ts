import { describe, expect, it } from "vitest";

import {
  readPendingRequestUserInputEvent,
  readPendingRequestUserInputPayload,
} from "./use-agent-thread";

const question = {
  id: "market_scope",
  header: "研究范围",
  question: "这次需要研究什么范围？",
  isOther: true,
  isSecret: false,
  options: null,
};

describe("request_user_input protocol channels", () => {
  it("accepts an App Server free-form question without fixed options", () => {
    expect(readPendingRequestUserInputEvent({
      type: "server_request",
      id: 21,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread_12345678",
        turnId: "turn_12345678",
        itemId: "item-1",
        questions: [question],
        isBlocking: true,
      },
    })).toMatchObject({
      requestId: "21",
      origin: "codex_app_server",
      questions: [{ options: [] }],
    });
  });

  it("keeps Commerce approval separate from App Server server requests", () => {
    expect(readPendingRequestUserInputEvent({
      type: "notification",
      method: "commerce/approval/requested",
      params: {
        requestId: "external_data_call-1",
        threadId: "thread_12345678",
        turnId: "turn_12345678",
        itemId: "call_12345678",
        questions: [{ ...question, options: [{ label: "允许", description: "仅本次" }] }],
        action: "external_data.call",
        origin: "commerce_approval",
      },
    })).toMatchObject({
      requestId: "external_data_call-1",
      origin: "commerce_approval",
      action: "external_data.call",
    });
    expect(readPendingRequestUserInputEvent({
      type: "server_request",
      id: "fake-1",
      method: "tool/requestUserInput",
      params: {},
    })).toBeNull();
  });

  it("rejects an application approval payload without an explicit action", () => {
    expect(readPendingRequestUserInputPayload({
      requestId: "approval-1",
      threadId: "thread_12345678",
      turnId: "turn_12345678",
      itemId: "call_12345678",
      questions: [question],
      origin: "commerce_approval",
    })).toBeNull();
  });

  it("preserves the application-owned product activation approval identity", () => {
    expect(readPendingRequestUserInputEvent({
      type: "notification",
      method: "commerce/approval/requested",
      params: {
        requestId: "product_call-1",
        threadId: "thread_12345678",
        turnId: "turn_12345678",
        itemId: "call_12345678",
        questions: [{ ...question, options: [{ label: "激活并导入", description: "发布并回读" }] }],
        action: "product_catalog.activate_import",
        origin: "commerce_approval",
      },
    })).toMatchObject({
      requestId: "product_call-1",
      origin: "commerce_approval",
      action: "product_catalog.activate_import",
    });
  });
});
