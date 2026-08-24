import { describe, expect, it } from "vitest";

import type { ConversationMessage } from "./use-agent-thread";
import { mergeAuthoritativeMessages } from "./message-reconciliation";

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
});
