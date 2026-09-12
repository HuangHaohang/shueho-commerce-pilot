import { afterEach, describe, expect, it, vi } from "vitest";

import { AGENT_READ_TIMEOUT_MS, readAgentJson } from "./agent-read";
import { createEventStreamRecovery } from "./event-stream-recovery";

describe("bounded Agent readback", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("bounds a request that never returns and aborts its transport without retrying it", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const read = readAgentJson("/api/agent/threads/owned/status");
    const failed = expect(read).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(AGENT_READ_TIMEOUT_MS);
    await failed;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the deadline active while a response body never finishes", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) });
    vi.stubGlobal("fetch", fetchMock);
    const read = readAgentJson("/api/agent/threads/owned");
    const failed = expect(read).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(AGENT_READ_TIMEOUT_MS);
    await failed;
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it("cancels an old thread immediately without aborting a new thread's request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const oldThread = new AbortController();
    const newThread = new AbortController();
    const oldRead = readAgentJson("/api/agent/threads/old/status", { signal: oldThread.signal });
    const oldFailure = expect(oldRead).rejects.toMatchObject({ name: "AbortError" });
    oldThread.abort();
    const newRead = readAgentJson("/api/agent/threads/new/status", { signal: newThread.signal });
    const newFailure = expect(newRead).rejects.toMatchObject({ name: "AbortError" });
    await oldFailure;
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(fetchMock.mock.calls[1]![1].signal.aborted).toBe(false);
    newThread.abort();
    await newFailure;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not dispatch a read after the parent lifecycle has already ended", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(readAgentJson("/api/agent/threads/old", { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases successful read timers and keeps HTTP denial visible to the caller", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "denied" }), { status: 403 })));
    await expect(readAgentJson("/api/agent/threads/foreign")).resolves.toEqual({
      ok: false, status: 403, payload: { error: "denied" },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves a timed-out reconnect pending and recovers on the next read-only watchdog attempt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(new Response(JSON.stringify({ thread: { status: "completed" } })));
    vi.stubGlobal("fetch", fetchMock);
    const recovery = createEventStreamRecovery(async () => {
      const read = await readAgentJson("/api/agent/threads/owned/status");
      return read.ok;
    });
    await recovery.onOpen();
    const attempt = recovery.onOpen();
    await vi.advanceTimersByTimeAsync(AGENT_READ_TIMEOUT_MS);
    await attempt;
    expect(recovery.pending).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    await recovery.reconcile();
    expect(recovery.pending).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  });
});
