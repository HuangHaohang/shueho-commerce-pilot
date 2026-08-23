import { describe, expect, it } from "vitest";

import { billingPeriodStart } from "./billing-period";

describe("enterprise billing window", () => {
  it("uses the current month anchor after the anchor day", () => {
    expect(billingPeriodStart(5, new Date("2026-08-23T12:00:00Z")).toISOString()).toBe(
      "2026-08-05T00:00:00.000Z",
    );
  });

  it("uses the previous month anchor before the anchor day", () => {
    expect(billingPeriodStart(5, new Date("2026-08-02T12:00:00Z")).toISOString()).toBe(
      "2026-07-05T00:00:00.000Z",
    );
  });
});
