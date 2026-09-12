import { describe, expect, it, vi } from "vitest";

import { LocalModelWarmupRecovery } from "./local-model-warmup-recovery.js";

describe("LocalModelWarmupRecovery", () => {
  it("keeps startup alive, retries warmup, and logs only state transitions", async () => {
    const warmup = vi.fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockRejectedValueOnce(new Error("still unavailable"))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("lost again"));
    const events: string[] = [];
    const recovery = new LocalModelWarmupRecovery({ warmup }, ({ event }) => events.push(event));

    await expect(recovery.attempt()).resolves.toBe(false);
    await expect(recovery.attempt()).resolves.toBe(false);
    expect(recovery.isReady()).toBe(false);
    expect(events).toEqual(["local_model_warmup_unavailable"]);

    await expect(recovery.attempt()).resolves.toBe(true);
    expect(recovery.isReady()).toBe(true);
    expect(events).toEqual(["local_model_warmup_unavailable", "local_model_warmup_ready"]);

    await expect(recovery.attempt()).resolves.toBe(false);
    expect(recovery.isReady()).toBe(false);
    expect(events).toEqual([
      "local_model_warmup_unavailable",
      "local_model_warmup_ready",
      "local_model_warmup_unavailable",
    ]);
  });

  it("coalesces concurrent recovery attempts", async () => {
    let resolveWarmup: (() => void) | undefined;
    const warmup = vi.fn(() => new Promise<void>((resolve) => { resolveWarmup = resolve; }));
    const recovery = new LocalModelWarmupRecovery({ warmup }, () => undefined);

    const first = recovery.attempt();
    const second = recovery.attempt();
    expect(first).toBe(second);
    expect(warmup).toHaveBeenCalledTimes(1);
    resolveWarmup?.();
    await expect(first).resolves.toBe(true);
  });
});
