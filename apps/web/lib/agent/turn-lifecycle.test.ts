import { describe, expect, it } from "vitest";

import { activateTurnClock } from "./turn-lifecycle";

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
});
