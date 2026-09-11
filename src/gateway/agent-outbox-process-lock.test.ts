import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
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

test("releases ownership after an abruptly terminated process without deleting the lock file", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-outbox-crash-"));
  const moduleUrl = new URL("./agent-outbox-process-lock.js", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { AgentOutboxProcessLock } from ${JSON.stringify(moduleUrl)};
    const lock = new AgentOutboxProcessLock(${JSON.stringify(root)});
    await lock.acquire("gateway");
    process.stdout.write("locked");
    setInterval(() => {}, 1000);
  `], { stdio: ["ignore", "pipe", "ignore"] });
  const replacement = new AgentOutboxProcessLock(root);
  try {
    await once(child.stdout!, "data");
    await assert.rejects(() => replacement.acquire("gateway"), /owned by an active/);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    await replacement.acquire("gateway");
    await replacement.release();
  } finally {
    child.kill("SIGKILL");
    await replacement.release();
    await rm(root, { recursive: true, force: true });
  }
});

test("does not steal a legacy PID lock from another container namespace", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-outbox-legacy-"));
  try {
    await mkdir(join(root, "commerce-runtime"));
    await writeFile(join(root, "commerce-runtime", "agent-event-outbox.lock"), JSON.stringify({ pid: 1, purpose: "gateway" }));
    await assert.rejects(() => new AgentOutboxProcessLock(root).acquire("gateway"), /legacy process/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
