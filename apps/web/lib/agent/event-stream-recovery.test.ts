import { describe, expect, it, vi } from "vitest";

import { createEventStreamRecovery } from "./event-stream-recovery";

describe("SSE reconnect readback", () => {
  it("uses existing load/watchdog on first open and immediately reads back on reopen", async () => {
    const recover = vi.fn().mockResolvedValue(true);
    const recovery = createEventStreamRecovery(recover);
    await recovery.onOpen();
    expect(recover).not.toHaveBeenCalled();
    await recovery.onOpen();
    expect(recover).toHaveBeenCalledOnce();
    expect(recovery.pending).toBe(false);
    await recovery.reconcile();
    expect(recover).toHaveBeenCalledOnce();
  });

  it("does not overlap readbacks during reconnect storms, and covers a newer gap on the next watchdog", async () => {
    let resolveFirst!: (value: boolean) => void;
    const recover = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(true);
    const recovery = createEventStreamRecovery(recover);
    await recovery.onOpen();
    const first = recovery.onOpen();
    await Promise.resolve();
    const next = recovery.onOpen();
    expect(recovery.reconcile()).toBe(first);
    expect(next).toBe(first);
    expect(recover).toHaveBeenCalledOnce();
    resolveFirst(true);
    await first;
    expect(recovery.pending).toBe(true);
    await recovery.reconcile();
    expect(recover).toHaveBeenCalledTimes(2);
    expect(recovery.pending).toBe(false);
  });

  it("keeps a failed or busy readback pending instead of declaring the native Turn failed", async () => {
    const recover = vi.fn()
      .mockRejectedValueOnce(new Error("read unavailable"))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const recovery = createEventStreamRecovery(recover);
    await recovery.onOpen();
    await recovery.onOpen();
    expect(recovery.pending).toBe(true);
    await recovery.reconcile();
    expect(recovery.pending).toBe(true);
    await recovery.reconcile();
    expect(recovery.pending).toBe(false);
    expect(recover).toHaveBeenCalledTimes(3);
  });
});
