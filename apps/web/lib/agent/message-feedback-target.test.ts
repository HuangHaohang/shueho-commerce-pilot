import { describe, expect, it } from "vitest";

import { readRateableAgentMessageTarget } from "./message-feedback-target";

function threadPayload(
  status: string,
  items: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    result: {
      thread: {
        turns: [{ id: "turn-12345678", status, items }],
      },
    },
  };
}

describe("rateable Harness agent message target", () => {
  it("returns a completed final agentMessage using Harness ids", () => {
    const target = readRateableAgentMessageTarget(
      threadPayload("completed", [{
        id: "message-1",
        type: "agentMessage",
        phase: "final_answer",
        text: "最终回复",
      }]),
      "message-1",
    );

    expect(target).toEqual({ turnId: "turn-12345678", text: "最终回复" });
  });

  it("rejects commentary and non-terminal turns", () => {
    expect(readRateableAgentMessageTarget(
      threadPayload("completed", [{
        id: "message-1",
        type: "agentMessage",
        phase: "commentary",
        text: "正在查询",
      }]),
      "message-1",
    )).toBeNull();
    expect(readRateableAgentMessageTarget(
      threadPayload("inProgress", [{
        id: "message-2",
        type: "agentMessage",
        phase: "final_answer",
        text: "尚未完成",
      }]),
      "message-2",
    )).toBeNull();
  });

  it("rejects browser-supplied ids that do not identify an agentMessage", () => {
    expect(readRateableAgentMessageTarget(
      threadPayload("completed", [{
        id: "message-user",
        type: "userMessage",
        content: [{ type: "text", text: "用户内容" }],
      }]),
      "message-user",
    )).toBeNull();
    expect(readRateableAgentMessageTarget(
      threadPayload("completed", []),
      "missing-message",
    )).toBeNull();
  });
});
