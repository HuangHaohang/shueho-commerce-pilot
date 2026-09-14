import { describe, expect, it } from "vitest";
import { serviceIsReady } from "./service-readiness.js";

describe("external data infrastructure readiness", () => {
  const infrastructure = { databaseConnected: true, models: { ok: true }, search: { status: "green" } };
  it("does not require a catalog, pricing receipt, key or quota snapshot", () => {
    expect(serviceIsReady(infrastructure)).toBe(true);
  });
  it("fails on a live infrastructure outage", () => {
    expect(serviceIsReady({ ...infrastructure, databaseConnected: false })).toBe(false);
    expect(serviceIsReady({ ...infrastructure, models: { ok: false } })).toBe(false);
    expect(serviceIsReady({ ...infrastructure, search: { status: "unavailable" } })).toBe(false);
  });
});
