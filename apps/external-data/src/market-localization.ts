import OpenCC from "opencc-js";

import type { ProviderWorkflowMarketOption } from "./business-workflows.js";
import type { JsonObject } from "./types.js";

const toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
const toTraditionalTaiwan = OpenCC.Converter({ from: "cn", to: "tw" });

const SCRIPT_PATTERNS: Record<string, RegExp> = {
  Arab: /\p{Script=Arabic}/u,
  Deva: /\p{Script=Devanagari}/u,
  Hans: /\p{Script=Han}/u,
  Hant: /\p{Script=Han}/u,
  Jpan: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  Latn: /\p{Script=Latin}/u,
  Thai: /\p{Script=Thai}/u,
};

export type MarketplaceMarketContext = {
  profileId: string;
  profileRevision: string;
  marketCode: string;
  displayName: string;
  preferredQueryLocale: string;
  queryLocales: string[];
  acceptedQueryLanguages: string[];
  timezone: string;
  currency: string;
  keywordLocalizationPolicy: "none" | "agent_generated_validated";
  expectedScripts: string[];
  qualityPolicy: JsonObject;
};

export function marketContextFromOption(option: ProviderWorkflowMarketOption): MarketplaceMarketContext {
  return {
    profileId: option.profileId,
    profileRevision: option.profileRevision,
    marketCode: option.code,
    displayName: option.displayName,
    preferredQueryLocale: option.preferredQueryLocale,
    queryLocales: option.queryLocales,
    acceptedQueryLanguages: option.acceptedQueryLanguages,
    timezone: option.timezone,
    currency: option.currency,
    keywordLocalizationPolicy: option.keywordLocalizationPolicy,
    expectedScripts: option.expectedScripts,
    qualityPolicy: option.qualityPolicy,
  };
}

export function validateLocalizedKeywords(
  keywords: string[],
  context: MarketplaceMarketContext,
): string[] {
  const normalized = uniqueTerms(keywords);
  if (context.keywordLocalizationPolicy === "none") return normalized;
  if (!normalized.length) {
    throw new MarketplaceLocalizationError(
      `市场 ${context.displayName} 需要 ${context.preferredQueryLocale} 检索词。`,
      "LOCALIZED_KEYWORD_REQUIRED",
    );
  }
  const patterns = context.expectedScripts
    .map((script) => SCRIPT_PATTERNS[script])
    .filter((pattern): pattern is RegExp => Boolean(pattern));
  if (!patterns.length) {
    throw new MarketplaceLocalizationError(
      `市场 ${context.displayName} 的检索脚本策略无效。`,
      "MARKET_PROFILE_INVALID",
    );
  }
  for (const keyword of normalized) {
    if (!patterns.some((pattern) => pattern.test(keyword))) {
      throw new MarketplaceLocalizationError(
        `检索词“${keyword}”不符合 ${context.displayName} 的 ${context.preferredQueryLocale} 脚本要求。`,
        "LOCALIZED_KEYWORD_INVALID",
      );
    }
  }
  return normalized;
}

export function expandMultilingualQueryTerms(terms: Array<string | null | undefined>): string[] {
  const normalized = uniqueTerms(terms.filter((term): term is string => typeof term === "string"));
  const expanded = [...normalized];
  for (const term of normalized) {
    if (!/\p{Script=Han}/u.test(term)) continue;
    expanded.push(toSimplified(term), toTraditionalTaiwan(term));
  }
  return uniqueTerms(expanded);
}

function uniqueTerms(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!normalized || normalized.length > 500) continue;
    const key = normalized.toLocaleLowerCase("und");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= 8) break;
  }
  return result;
}

export class MarketplaceLocalizationError extends Error {
  constructor(
    message: string,
    readonly code: "LOCALIZED_KEYWORD_REQUIRED" | "LOCALIZED_KEYWORD_INVALID" | "MARKET_PROFILE_INVALID",
  ) {
    super(message);
    this.name = "MarketplaceLocalizationError";
  }
}
