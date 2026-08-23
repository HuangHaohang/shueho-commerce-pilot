import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentOutboxProcessLock } from "./agent-outbox-process-lock.js";

test("prevents a maintenance writer from racing an active Gateway outbox", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-outbox-lock-"));
  try {
    const gateway = new AgentOutboxProcessLock(root);
    const maintenance = new AgentOutboxProcessLock(root);
    await gateway.acquire("gateway");
    await assert.rejects(() => maintenance.acquire("maintenance"), /owned by an active/);
    await gateway.release();
    await maintenance.acquire("maintenance");
    await maintenance.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
