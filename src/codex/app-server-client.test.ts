import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { setImmediate as nextTick } from "node:timers/promises";
import test from "node:test";

import { CodexAppServerClient } from "./app-server-client.js";

type Message = { id?: number; method: string; params?: unknown };

class AppServerProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  messages: Message[] = [];
  killed = false;
  exitCode: number | null = null;
  pid = 123;
  stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      const message = JSON.parse(chunk.toString()) as Message;
      this.messages.push(message);
      this.onMessage?.(message);
      callback();
    },
  });
  onMessage?: (message: Message) => void;
  kill(): boolean { this.killed = true; return true; }
  reply(message: Message, result: unknown): void {
    this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
  }
  initialize(): void {
    const initialize = this.messages.find((message) => message.method === "initialize");
    assert.ok(initialize);
    this.reply(initialize, { userAgent: "fixture" });
  }
  exit(code = 0): void {
    this.exitCode = code;
    this.emit("exit", code, null);
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, null);
  }
}

function fixture() {
  const children: AppServerProcess[] = [];
  const spawnProcess = () => {
    const child = new AppServerProcess();
    children.push(child);
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  const client = new CodexAppServerClient({ codexBin: "fixture-only", cwd: process.cwd(), requestTimeoutMs: 1000 }, spawnProcess);
  return { client, children };
}

test("100 concurrent cold requests share one completed initialization before any business RPC", async () => {
  const { client, children } = fixture();
  const pending = Array.from({ length: 100 }, () => client.request("thread/list", { limit: 1 }));
  assert.equal(children.length, 1);
  const child = children[0];
  assert.deepEqual(child.messages.map((message) => message.method), ["initialize"]);
  child.onMessage = (message) => {
    if (message.method === "thread/list") {
      assert.ok(child.messages.some((candidate) => candidate.method === "initialized"));
      child.reply(message, { data: [] });
    }
  };
  child.initialize();
  assert.equal((await Promise.all(pending)).length, 100);
  assert.equal(client.isInitialized, true);
  assert.equal(child.messages.filter((message) => message.method === "initialize").length, 1);
  await client.stop();
  child.exit();
});

test("an old process exit and late output cannot clear a replacement process or its pending RPC", async () => {
  const { client, children } = fixture();
  const firstStart = client.start();
  children[0].initialize();
  await firstStart;
  await client.stop();
  const replacementStart = client.start();
  const replacement = children[1];
  replacement.initialize();
  await replacementStart;
  const read = client.request("thread/list", {});
  await nextTick();
  children[0].stdout.write(`${JSON.stringify({ id: 998, method: "item/tool/requestUserInput", params: {} })}\n`);
  children[0].exit();
  assert.equal(client.isRunning, true);
  assert.equal(client.isInitialized, true);
  assert.equal(client.listPendingServerRequests().length, 0);
  const message = replacement.messages.find((candidate) => candidate.method === "thread/list");
  assert.ok(message);
  replacement.reply(message, { data: ["replacement"] });
  assert.deepEqual(await read, { data: ["replacement"] });
  await client.stop();
  replacement.exit();
});

test("stop rejects an in-progress handshake for all callers and permits a fresh start", async () => {
  const { client, children } = fixture();
  const calls = [client.start(), client.request("thread/list", {})];
  const outcomes = Promise.allSettled(calls);
  await client.stop();
  assert.deepEqual((await outcomes).map((outcome) => outcome.status), ["rejected", "rejected"]);
  assert.equal(client.isInitialized, false);
  const restarted = client.start();
  children[1].initialize();
  await restarted;
  children[0].exit();
  assert.equal(client.isRunning, true);
  await client.stop();
  children[1].exit();
});

test("spawn errors reject a shared startup promptly and a later start can succeed", async () => {
  const { client, children } = fixture();
  const outcomes = Promise.allSettled([client.start(), client.start()]);
  children[0].emit("error", new Error("fixture spawn failure"));
  assert.deepEqual((await outcomes).map((outcome) => outcome.status), ["rejected", "rejected"]);
  assert.equal(client.isInitialized, false);
  const restarted = client.start();
  children[1].initialize();
  await restarted;
  children[0].exit();
  await client.stop();
  children[1].exit();
});

test("a stdin failure rejects pending RPCs without waiting for request timeouts", async () => {
  const { client, children } = fixture();
  const started = client.start();
  const child = children[0];
  child.initialize();
  await started;
  const outcome = Promise.allSettled([client.request("thread/list", {})]);
  await nextTick();
  child.stdin.emit("error", new Error("fixture pipe failure"));
  assert.equal((await outcome)[0].status, "rejected");
  assert.equal(client.isInitialized, false);
  child.exit();
});
