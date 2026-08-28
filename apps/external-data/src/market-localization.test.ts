import { describe, expect, it } from "vitest";

import {
  expandMultilingualQueryTerms,
  MarketplaceLocalizationError,
  validateLocalizedKeywords,
} from "./market-localization.js";

describe("market query localization", () => {
  it("expands Chinese query terms across simplified and Taiwan traditional forms", () => {
    const terms = expandMultilingualQueryTerms(["休闲运动裤"]);
    expect(terms).toContain("休闲运动裤");
    expect(terms).toContain("休閒運動褲");
  });

  it("validates the selected market script instead of guessing from a country label", () => {
    const context = {
      profileId: "00000000-0000-4000-8000-000000000001",
      profileRevision: "a".repeat(64),
      marketCode: "TH",
      displayName: "泰国站",
      preferredQueryLocale: "th-TH",
      queryLocales: ["th-TH"],
      acceptedQueryLanguages: ["th"],
      timezone: "Asia/Bangkok",
      currency: "THB",
      keywordLocalizationPolicy: "agent_generated_validated" as const,
      expectedScripts: ["Thai", "Latn"],
      qualityPolicy: {},
    };
    expect(validateLocalizedKeywords(["กางเกงกีฬาลำลอง"], context))
      .toEqual(["กางเกงกีฬาลำลอง".normalize("NFKC")]);
    expect(validateLocalizedKeywords(["iPhone 16"], context)).toEqual(["iPhone 16"]);
    expect(() => validateLocalizedKeywords(["休闲运动裤"], context)).toThrowError(MarketplaceLocalizationError);
  });
});
