import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { SseConnection } from "./sse-connection.js";

class Subscriber extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  frames: string[] = [];
  blocked = false;
  write(frame: string): boolean {
    this.frames.push(frame);
    if (this.blocked) this.writableLength += Buffer.byteLength(frame);
    return !this.blocked;
  }
  end(): void { this.writableEnded = true; this.emit("finish"); }
  destroy(): void { this.destroyed = true; this.emit("close"); }
  drain(): void { this.writableLength = 0; this.blocked = false; this.emit("drain"); }
  connection(onClose: () => void, options: { maxBufferedBytes?: number; maxBlockedMs?: number; heartbeatIntervalMs?: number } = {}) {
    return new SseConnection(this as unknown as ServerResponse, { onClose, ...options });
  }
}

test("100 subscribers keep event order while slow consumers stay within the byte budget", () => {
  const subscribers = Array.from({ length: 100 }, (_, index) => {
    const response = new Subscriber();
    response.blocked = index < 50;
    let closed = 0;
    return { response, connection: response.connection(() => { closed += 1; }, { maxBufferedBytes: 64 }), closes: () => closed };
  });
  const frames = Array.from({ length: 20 }, (_, index) => `event: notification\ndata: ${index}\n\n`);
  try {
    for (const frame of frames) for (const { connection } of subscribers) connection.send(frame);
    for (const [index, subscriber] of subscribers.entries()) {
      if (index < 50) {
        assert.equal(subscriber.response.destroyed, true);
        assert.ok(subscriber.response.writableLength <= 64);
        assert.equal(subscriber.closes(), 1);
      } else {
        assert.deepEqual(subscriber.response.frames, frames);
        assert.equal(subscriber.closes(), 0);
      }
    }
  } finally {
    for (const { connection } of subscribers) connection.close();
  }
});

test("a temporarily blocked subscriber resumes after drain without losing queued frames", async () => {
  const response = new Subscriber();
  response.blocked = true;
  let closed = 0;
  const connection = response.connection(() => { closed += 1; }, { maxBlockedMs: 15 });
  connection.send("first\n\n");
  response.drain();
  connection.send("second\n\n");
  await delay(30);
  assert.equal(closed, 0);
  assert.deepEqual(response.frames, ["first\n\n", "second\n\n"]);
  connection.close();
});

test("an idle blocked subscriber is disconnected and all heartbeat/listener state is released", async () => {
  const response = new Subscriber();
  response.blocked = true;
  let closed = 0;
  const connection = response.connection(() => { closed += 1; }, { maxBlockedMs: 10, heartbeatIntervalMs: 5 });
  connection.send("first\n\n");
  await delay(30);
  const count = response.frames.length;
  assert.equal(response.destroyed, true);
  assert.equal(closed, 1);
  assert.equal(connection.send("late\n\n"), false);
  assert.deepEqual(response.eventNames(), []);
  await delay(15);
  assert.equal(response.frames.length, count);
  connection.close();
  assert.equal(closed, 1);
});

test("peer close, finish, write failure and error each clean up exactly once", () => {
  for (const failure of ["close", "finish", "error", "write"] as const) {
    const response = new Subscriber();
    let closed = 0;
    const connection = response.connection(() => { closed += 1; });
    if (failure === "write") {
      response.write = () => { throw new Error("closed transport"); };
      assert.equal(connection.send("frame"), false);
    } else {
      response.emit(failure);
    }
    connection.close();
    assert.equal(closed, 1);
    assert.deepEqual(response.eventNames(), []);
  }
});

test("shutdown releases a blocked subscriber without waiting indefinitely for its socket", () => {
  const response = new Subscriber();
  response.blocked = true;
  let closed = 0;
  const connection = response.connection(() => { closed += 1; });
  connection.send("pending\n\n");
  connection.close();
  assert.equal(response.destroyed, true);
  assert.equal(closed, 1);
  assert.deepEqual(response.eventNames(), []);
});
