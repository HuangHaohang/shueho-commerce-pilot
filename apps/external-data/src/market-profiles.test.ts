import { describe, expect, it } from "vitest";

import { readMarketProfileSource } from "./market-profiles.js";

describe("market language profile source", () => {
  it("loads versioned unique profiles with executable locale metadata", () => {
    const source = readMarketProfileSource();
    expect(source.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.profiles.length).toBeGreaterThanOrEqual(37);
    expect(new Set(source.profiles.map((profile) => `${profile.platformId}:${profile.marketCode}`)).size)
      .toBe(source.profiles.length);
    expect(source.profiles.find((profile) => profile.platformId === "shopee" && profile.marketCode === "TH"))
      .toMatchObject({ preferredQueryLocale: "th-TH", currency: "THB", expectedScripts: ["Thai", "Latn"] });
    expect(source.profiles.find((profile) => profile.platformId === "shopee" && profile.marketCode === "SG"))
      .toMatchObject({ preferredQueryLocale: "en-SG", currency: "SGD" });
  });
});
