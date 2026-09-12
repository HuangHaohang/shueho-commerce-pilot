import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scheduleSseAuthorizationChecks, SSE_AUTHORIZATION_INTERVAL_MS } from "./sse-authorization-scheduler";

describe("staggered SSE authorization checks", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it("spreads first checks and then retains a fixed 15-second cadence without completion-time drift", async () => {
    const observed: number[] = [];
    const stop = scheduleSseAuthorizationChecks({ random: () => 0.5, revoke: vi.fn(), check: async () => {
      observed.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, 2000));
      return true;
    } });
    await vi.advanceTimersByTimeAsync(7499);
    expect(observed).toEqual([]);
    await vi.advanceTimersByTimeAsync(30001);
    expect(observed).toEqual([7500, 22500, 37500]);
    stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 0.999999, 1, Number.NaN, -1, 2])("never postpones the first check beyond the original interval for random=%s", async (value) => {
    const check = vi.fn().mockResolvedValue(true);
    const stop = scheduleSseAuthorizationChecks({ check, revoke: vi.fn(), random: () => value });
    await vi.advanceTimersByTimeAsync(SSE_AUTHORIZATION_INTERVAL_MS);
    expect(check).toHaveBeenCalled();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the initial timer when the browser disconnects before its first check", async () => {
    const check = vi.fn().mockResolvedValue(true);
    const stop = scheduleSseAuthorizationChecks({ check, revoke: vi.fn(), random: () => 0.8 });
    stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a queued authorization read after cleanup", async () => {
    const check = vi.fn().mockResolvedValue(true);
    const stop = scheduleSseAuthorizationChecks({ check, revoke: vi.fn(), random: () => 0 });
    vi.advanceTimersByTime(0);
    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails closed by the next scheduled interval when authorization never returns, without overlapping reads", async () => {
    const check = vi.fn().mockReturnValue(new Promise(() => {}));
    const revoke = vi.fn();
    scheduleSseAuthorizationChecks({ check, revoke, random: () => 0.2 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(SSE_AUTHORIZATION_INTERVAL_MS);
    expect(check).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(check).toHaveBeenCalledOnce();
  });

  it.each(["denied", "error"])("immediately revokes on %s and cancels the remaining timers", async (failure) => {
    const check = failure === "denied" ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(new Error("database unavailable"));
    const revoke = vi.fn();
    scheduleSseAuthorizationChecks({ check, revoke, random: () => 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(revoke).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleanup cancels interval and deadline and ignores a late rejected check", async () => {
    let reject!: (reason: Error) => void;
    const revoke = vi.fn();
    const stop = scheduleSseAuthorizationChecks({ random: () => 0, revoke,
      check: () => new Promise((_resolve, rejectCheck) => { reject = rejectCheck; }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(2);
    stop();
    reject(new Error("late failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(revoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
