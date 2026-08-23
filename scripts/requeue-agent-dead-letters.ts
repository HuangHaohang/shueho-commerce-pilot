import "dotenv/config";

import { resolve } from "node:path";

import { AgentEventOutbox } from "../src/gateway/agent-event-outbox.js";
import { AgentOutboxProcessLock } from "../src/gateway/agent-outbox-process-lock.js";

const codexHome = resolve(process.cwd(), process.env.CODEX_HOME || ".runtime/codex");
const outbox = new AgentEventOutbox(codexHome);
const processLock = new AgentOutboxProcessLock(codexHome);
await processLock.acquire("maintenance");
try {
  await outbox.load();
  const requeued = await outbox.requeueDeadLetters();
  console.log(JSON.stringify({ ok: true, requeued, pending: outbox.list().length }));
} finally {
  await processLock.release();
}
