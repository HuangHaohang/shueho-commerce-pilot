import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { AgentEventOutbox, type UsageCompletedEvent } from "./agent-event-outbox.js";

test("persists and deduplicates exact Codex response usage events", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-agent-outbox-"));
  try {
    const event: UsageCompletedEvent = {
      kind: "usage.response.completed",
      eventId: "usage:provider:response-1",
      tenantId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      userId: "user-1",
      rootThreadId: "thread-root",
      threadId: "thread-root",
      parentThreadId: null,
      turnId: "turn-0001",
      model: "gpt-test",
      responseId: "response-1",
      providerId: "provider",
      occurredAt: "2026-08-23T00:00:00.000Z",
      usage: {
        totalTokens: 150,
        inputTokens: 100,
        cachedInputTokens: 60,
        cacheWriteInputTokens: 20,
        outputTokens: 50,
        reasoningOutputTokens: 10,
      },
    };
    const first = new AgentEventOutbox(root);
    assert.equal(await first.enqueue(event), true);
    assert.equal(await first.enqueue(event), false);

    const restored = new AgentEventOutbox(root);
    await restored.load();
    assert.deepEqual(restored.list(), [event]);
    await restored.acknowledge(event.eventId);
    assert.deepEqual(restored.list(), []);
    assert.equal(await restored.enqueue(event), true);
    await restored.quarantine(event.eventId, "HTTP 422");
    assert.deepEqual(restored.list(), []);
    assert.equal(restored.deadLetterCount(), 1);

    const restoredDeadLetter = new AgentEventOutbox(root);
    await restoredDeadLetter.load();
    assert.equal(restoredDeadLetter.deadLetterCount(), 1);
    assert.equal(await restoredDeadLetter.requeueDeadLetters(), 1);
    assert.deepEqual(restoredDeadLetter.list(), [event]);
    assert.equal(restoredDeadLetter.deadLetterCount(), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
