import { describe, expect, it } from "vitest";

import { internalAgentEventSchema } from "./agent-event-schema";

const event = {
  kind: "skill.published",
  eventId: "skill:event:1",
  tenantId: "1db38609-3d70-4dd6-963a-5274383d62f4",
  workspaceId: "18a08712-7f48-45c8-92dc-507ecdcdb782",
  userId: "user-1",
  rootThreadId: "thread-12345678",
  threadId: "thread-12345678",
  parentThreadId: null,
  turnId: "turn-12345678",
  occurredAt: "2026-08-25T03:00:00.000Z",
  model: "gpt-5.6-sol",
  skillName: "commerce-product-copywriter",
  operation: "created",
  contentHash: "a".repeat(64),
};

describe("enterprise Agent events", () => {
  it("accepts a bounded skill publication audit event", () => {
    expect(internalAgentEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects a skill event with an unsafe or unscoped name", () => {
    expect(internalAgentEventSchema.safeParse({ ...event, skillName: "../escape" }).success).toBe(false);
  });
});
