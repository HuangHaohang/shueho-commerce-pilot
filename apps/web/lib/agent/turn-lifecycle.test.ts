import { describe, expect, it } from "vitest";

import {
  activateTurnClock,
  shouldExpireActiveTurn,
  shouldIgnoreTerminalSnapshotWhileConnecting,
} from "./turn-lifecycle";

describe("active turn lifecycle", () => {
  it("resets the clock when a different Harness turn becomes active", () => {
    expect(
      activateTurnClock({ turnId: "old-turn", startedAt: 1_000 }, "new-turn", 700_000),
    ).toEqual({ turnId: "new-turn", startedAt: 700_000 });
  });

  it("preserves the clock for duplicate start notifications from the same turn", () => {
    expect(
      activateTurnClock({ turnId: "turn-1", startedAt: 5_000 }, "turn-1", 8_000),
    ).toEqual({ turnId: "turn-1", startedAt: 5_000 });
  });

  it("never lets a stale timeout closure expire a newer turn", () => {
    const current = { turnId: "new-turn", startedAt: 700_000 };

    expect(shouldExpireActiveTurn(current, "old-turn", 1_000, 800_000, 600_000)).toBe(false);
    expect(shouldExpireActiveTurn(current, "new-turn", 700_000, 1_300_000, 600_000)).toBe(true);
  });

  it("ignores the previous terminal snapshot while a new turn is connecting", () => {
    expect(shouldIgnoreTerminalSnapshotWhileConnecting("connecting", "completed")).toBe(true);
    expect(shouldIgnoreTerminalSnapshotWhileConnecting("connecting", "running")).toBe(false);
    expect(shouldIgnoreTerminalSnapshotWhileConnecting("running", "completed")).toBe(false);
  });
});
