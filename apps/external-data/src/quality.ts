import type { QualityDecision } from "./types.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const REPLACEMENT_CHARACTER = /\uFFFD/g;

export function assessTextQuality(
  value: unknown,
  options: { maxLength: number; allowEmpty?: boolean; field: string },
): QualityDecision {
  if (typeof value !== "string") {
    return {
      status: options.allowEmpty && (value === null || value === undefined) ? "suspicious" : "rejected",
      reasons: ["INVALID_TEXT_TYPE"],
      normalizedValue: null,
    };
  }
  const controls = value.match(CONTROL_CHARACTERS)?.length ?? 0;
  const replacements = value.match(REPLACEMENT_CHARACTER)?.length ?? 0;
  const normalized = value
    .normalize("NFKC")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  const reasons: string[] = [];
  if (!normalized) reasons.push("EMPTY_VALUE");
  if (value.length > options.maxLength) reasons.push("VALUE_TOO_LONG");
  if (controls > 0) reasons.push("CONTROL_CHARACTERS");
  if (replacements > 0) reasons.push("UNICODE_REPLACEMENT_CHARACTER");
  if (looksLikeConcatenatedCatalog(value)) reasons.push("CATALOG_CONCATENATION");
  if (reasons.some((reason) => reason !== "EMPTY_VALUE") || (!options.allowEmpty && !normalized)) {
    return { status: "rejected", reasons, normalizedValue: normalized || null };
  }
  if (!normalized) return { status: "suspicious", reasons, normalizedValue: null };
  return { status: "valid", reasons, normalizedValue: normalized };
}

export function assessTaobaoItemQuality(item: Record<string, unknown>): QualityDecision {
  const title = assessTextQuality(item.itemName, { maxLength: 1000, field: "itemName" });
  const reasons = [...title.reasons];
  const price = numberValue(item.priceZKYuanDouble ?? item.discntPriceYuan ?? item.priceYuanDouble);
  if (price === null || price < 0 || price > 100_000_000) reasons.push("INVALID_PRICE");
  if (item.itemId === undefined || item.itemId === null || String(item.itemId).length > 64) reasons.push("INVALID_ITEM_ID");
  return {
    status: reasons.some((reason) => ["INVALID_PRICE", "INVALID_ITEM_ID", ...title.reasons].includes(reason))
      ? "rejected"
      : title.status,
    reasons: [...new Set(reasons)],
    normalizedValue: title.normalizedValue,
  };
}

export function lexicalRelevance(target: string | null, requestText: string, document: string): number {
  const targetText = target?.trim() || requestText.trim();
  if (!targetText || !document.trim()) return 0;
  const normalizedTarget = normalizeForMatch(targetText);
  const normalizedDocument = normalizeForMatch(document);
  if (normalizedTarget && normalizedDocument.includes(normalizedTarget)) return 1;
  const targetTokens = semanticTokens(targetText);
  const documentTokens = semanticTokens(document);
  if (!targetTokens.size || !documentTokens.size) return 0;
  let matchedWeight = 0;
  let totalWeight = 0;
  for (const token of targetTokens) {
    const weight = token.length >= 2 ? 2 : 1;
    totalWeight += weight;
    if (documentTokens.has(token) || normalizedDocument.includes(token)) matchedWeight += weight;
  }
  return clamp(matchedWeight / Math.max(1, totalWeight));
}

export function lexicalRelevanceMany(targets: string[], requestText: string, document: string): number {
  const normalizedTargets = [...new Set(targets.map((target) => target.trim()).filter(Boolean))];
  if (!normalizedTargets.length) return lexicalRelevance(null, requestText, document);
  return Math.max(...normalizedTargets.map((target) => lexicalRelevance(target, requestText, document)));
}

export function parseSalesDisplay(value: unknown): {
  display: string | null;
  lowerBound: number | null;
  upperBound: number | null;
  qualifier: "exact" | "gte" | "range" | "unknown" | null;
} {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { display: null, lowerBound: null, upperBound: null, qualifier: null };
  }
  const display = String(value).normalize("NFKC").trim();
  const exact = display.match(/^([0-9][0-9,]*)$/);
  if (exact) {
    const amount = Number(exact[1]?.replaceAll(",", ""));
    return { display, lowerBound: amount, upperBound: amount, qualifier: "exact" };
  }
  const lower = display.match(/^([0-9][0-9,]*)\+$/);
  if (lower) {
    return { display, lowerBound: Number(lower[1]?.replaceAll(",", "")), upperBound: null, qualifier: "gte" };
  }
  const range = display.match(/^([0-9][0-9,]*)\s*[-~至]\s*([0-9][0-9,]*)$/);
  if (range) {
    return {
      display,
      lowerBound: Number(range[1]?.replaceAll(",", "")),
      upperBound: Number(range[2]?.replaceAll(",", "")),
      qualifier: "range",
    };
  }
  return { display, lowerBound: null, upperBound: null, qualifier: "unknown" };
}

export function countControlCharacters(value: string): number {
  return value.match(CONTROL_CHARACTERS)?.length ?? 0;
}

function looksLikeConcatenatedCatalog(value: string): boolean {
  if (value.length < 40) return false;
  const controls = countControlCharacters(value);
  const slashSegments = value.split(/[\t\n\r\u0001-\u001f]/).filter(Boolean).length;
  return controls >= 3 || slashSegments >= 8;
}

function semanticTokens(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLowerCase();
  const tokens = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const chinese = [...normalized].filter((character) => /[\u3400-\u9fff]/.test(character)).join("");
  for (let index = 0; index < chinese.length - 1; index += 1) tokens.add(chinese.slice(index, index + 2));
  return tokens;
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
