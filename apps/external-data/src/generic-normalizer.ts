import { createHash } from "node:crypto";

import { assessTextQuality } from "./quality.js";
import { unwrapProviderPayload } from "./normalizers.js";
import type { JsonObject, ProviderEndpoint, QualityDecision } from "./types.js";

export type GenericNormalizedCollection = {
  jsonPointer: string;
  collectionKey: string | null;
  itemCount: number;
  rawData: unknown[];
  rawSha256: string;
};

export type GenericNormalizedRecord = {
  parentJsonPointer: string | null;
  collectionJsonPointer: string | null;
  jsonPointer: string;
  ordinal: number | null;
  recordKind: string;
  providerEntityId: string | null;
  titleRaw: string | null;
  summaryRaw: string | null;
  authorRaw: string | null;
  canonicalUrl: string | null;
  publishedAt: string | null;
  contentText: string | null;
  metrics: JsonObject;
  rawData: unknown;
  rawSha256: string;
  quality: QualityDecision;
  supportsPrice: boolean;
  supportsSales: boolean;
};

export type NormalizedGenericPayload = {
  providerPayload: JsonObject;
  dataRoot: unknown;
  collections: GenericNormalizedCollection[];
  records: GenericNormalizedRecord[];
};

const ID_KEYS = [
  "itemId", "item_id", "wareId", "ware_id", "wareid", "skuId", "sku_id", "skuid",
  "asin", "productId", "product_id",
  "videoId", "video_id", "awemeId", "aweme_id", "noteId", "note_id",
  "articleId", "article_id", "commentId", "comment_id", "userId", "user_id",
  "secUid", "sec_uid", "uid", "mid", "aid", "bvid", "shopId", "shop_id", "id",
];
const TITLE_KEYS = ["title", "name", "itemName", "item_name", "nickname", "displayName", "subject", "contentTitle", "noteTitle"];
const SUMMARY_KEYS = ["summary", "description", "desc", "content", "text", "abstract", "signature", "body"];
const AUTHOR_KEYS = ["author", "authorName", "author_name", "nickname", "userName", "user_name", "screenName", "screen_name", "shopName", "shop_name"];
const URL_KEYS = [
  "url", "link", "canonicalUrl", "canonical_url", "detailLink", "detail_link",
  "jumpDetailLink", "jump_detail_link", "shareUrl", "share_url", "articleUrl",
  "article_url", "videoUrl", "video_url", "noteUrl", "note_url",
];
const TIME_KEYS = ["publishedAt", "published_at", "publishTime", "publish_time", "createTime", "create_time", "createdAt", "created_at", "timestamp"];

export function normalizeGenericPayload(payload: JsonObject, endpoint: ProviderEndpoint): NormalizedGenericPayload {
  const providerPayload = unwrapProviderPayload(payload);
  const dataRoot = providerPayload.data ?? providerPayload;
  const collections: GenericNormalizedCollection[] = [];
  const records: GenericNormalizedRecord[] = [];
  records.push(normalizeRecord(dataRoot, "/data", null, null, null, endpoint));
  walkArrays(dataRoot, "/data", "/data", endpoint, collections, records);
  return { providerPayload, dataRoot, collections, records };
}

function walkArrays(
  value: unknown,
  pointer: string,
  parentRecordPointer: string,
  endpoint: ProviderEndpoint,
  collections: GenericNormalizedCollection[],
  records: GenericNormalizedRecord[],
): void {
  if (Array.isArray(value)) {
    const collection: GenericNormalizedCollection = {
      jsonPointer: pointer,
      collectionKey: pointer.split("/").at(-1) || null,
      itemCount: value.length,
      rawData: value,
      rawSha256: rawJsonSha(value),
    };
    collections.push(collection);
    value.forEach((item, ordinal) => {
      const itemPointer = `${pointer}/${ordinal}`;
      records.push(normalizeRecord(item, itemPointer, parentRecordPointer, pointer, ordinal, endpoint));
      walkArrays(item, itemPointer, itemPointer, endpoint, collections, records);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${pointer}/${escapePointer(key)}`;
    if (Array.isArray(child)) walkArrays(child, childPointer, parentRecordPointer, endpoint, collections, records);
    else if (isRecord(child)) walkArrays(child, childPointer, parentRecordPointer, endpoint, collections, records);
  }
}

function normalizeRecord(
  rawData: unknown,
  jsonPointer: string,
  parentJsonPointer: string | null,
  collectionJsonPointer: string | null,
  ordinal: number | null,
  endpoint: ProviderEndpoint,
): GenericNormalizedRecord {
  const title = deepFirstString(rawData, TITLE_KEYS);
  const summary = deepFirstString(rawData, SUMMARY_KEYS);
  const author = deepFirstString(rawData, AUTHOR_KEYS);
  const scalarText = typeof rawData === "string" ? rawData : null;
  const contentText = compactText([title, summary, author, scalarText]);
  const quality = assessTextQuality(contentText, { maxLength: 20_000, allowEmpty: true, field: "genericRecord" });
  const canonicalUrl = validUrl(deepFirstString(rawData, URL_KEYS));
  const publishedAt = parseTime(deepFirstValue(rawData, TIME_KEYS));
  const metrics = {
    ...extractMetrics(rawData),
    ...extractCommerceProductMetrics(rawData, endpoint),
  };
  const keys = isRecord(rawData) ? Object.keys(rawData).join(" ") : "";
  return {
    parentJsonPointer,
    collectionJsonPointer,
    jsonPointer,
    ordinal,
    recordKind: inferRecordKind(endpoint.responseFamily, jsonPointer, rawData),
    providerEntityId: deepFirstIdentifier(rawData, ID_KEYS),
    titleRaw: title,
    summaryRaw: summary,
    authorRaw: author,
    canonicalUrl,
    publishedAt,
    contentText,
    metrics,
    rawData,
    rawSha256: rawJsonSha(rawData),
    quality,
    supportsPrice: /price|amount|cost|售价|价格/i.test(keys),
    supportsSales: /sales|sold|volume|成交|销量/i.test(keys),
  };
}

function inferRecordKind(responseFamily: string, pointer: string, value: unknown): string {
  if (isDirectCommerceProductRecord(responseFamily, value)) return "product";
  const context = `${pointer} ${isRecord(value) ? Object.keys(value).join(" ") : ""}`.toLowerCase();
  if (/comment|reply|sub_comment|danmaku/.test(context)) return "comment";
  if (/product|item|sku|shop|store/.test(context)) return "product";
  if (/user|creator|account|profile|author/.test(context)) return "identity";
  if (/video|post|article|note|content|review|subtitle|caption/.test(context)) return "content";
  if (/metric|stat|trend|distribution|analysis|summary|ranking|price|amount|currency|sales|sold/.test(context)) return "metric";
  if (/link|url|resolve|transfer/.test(context)) return "link";
  return "record";
}

function isDirectCommerceProductRecord(responseFamily: string, value: unknown): boolean {
  if (!/commerce_product/i.test(responseFamily) || !isRecord(value)) return false;
  const keys = new Set(Object.keys(value).map((key) => key.toLowerCase()));
  return [
    "itemid", "item_id", "wareid", "ware_id", "skuid", "sku_id",
    "productid", "product_id", "asin",
  ].some((key) => keys.has(key));
}

function extractMetrics(value: unknown, depth = 0): JsonObject {
  if (!isRecord(value) || depth > 2) return {};
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if ((typeof child === "number" && Number.isFinite(child)) || typeof child === "boolean") result[key] = child;
    else if (isRecord(child)) {
      const nested = extractMetrics(child, depth + 1);
      if (Object.keys(nested).length) result[key] = nested;
    }
    if (Object.keys(result).length >= 100) break;
  }
  return result;
}

function extractCommerceProductMetrics(value: unknown, endpoint: ProviderEndpoint): JsonObject {
  if (!/commerce_product/i.test(endpoint.responseFamily) || !isRecord(value)) return {};
  const currency = normalizeCurrency(firstScalarText(value, [
    ["currency"], ["currencyCode"], ["currency_code"], ["priceCurrency"], ["price_currency"],
  ])) ?? defaultCommerceCurrency(endpoint.platformId);
  const priceAmount = firstFiniteNumber(value, [
    ["price_amount"], ["priceAmount"], ["display_price"], ["displayPrice"],
    ["salePrice"], ["sale_price"], ["dredisprice"],
    ["priceInfoView", "value"], ["priceInfo", "p"], ["price"],
  ]);
  const originalPriceAmount = firstFiniteNumber(value, [
    ["original_price_amount"], ["originalPriceAmount"], ["originalPrice"], ["original_price"],
    ["priceInfoView", "originPrice"], ["priceInfo", "op"],
  ]);
  const explicitPriceYuan = firstFiniteNumber(value, [["price_yuan"], ["priceYuan"]]);
  const explicitOriginalPriceYuan = firstFiniteNumber(value, [["original_price_yuan"], ["originalPriceYuan"]]);
  const priceYuan = explicitPriceYuan ?? (currency === "CNY" ? priceAmount : null);
  const originalPriceYuan = explicitOriginalPriceYuan ?? (currency === "CNY" ? originalPriceAmount : null);
  const priceTexts = firstStringArray(value, [["price_texts"], ["priceTexts"]]);
  const salesDisplay = firstScalarText(value, [
    ["sold_text"], ["soldText"], ["sales_display"], ["salesDisplay"],
    ["salesText"], ["sales_text"], ["sold"], ["sales"],
  ]);
  const parsedSales = salesDisplay ? parseLocalizedSalesCount(salesDisplay) : null;
  const reviewDisplay = firstScalarText(value, [
    ["commentData", "comment"], ["reviewCountText"], ["review_count_text"],
  ]);
  const reviewLowerBound = reviewDisplay ? parseLocalizedCountLowerBound(reviewDisplay) : null;
  const goodRate = firstFiniteNumber(value, [
    ["commentData", "goodRateNew"], ["commentData", "goodRate"], ["goodRate"], ["good_rate"],
  ]);
  const imageUrl = validUrl(firstScalarText(value, [
    ["image_url"], ["imageUrl"], ["image"], ["mainImage"], ["main_image"],
  ]));
  return {
    ...(priceAmount === null ? {} : { price_amount: priceAmount }),
    ...(originalPriceAmount === null ? {} : { original_price_amount: originalPriceAmount }),
    ...(priceYuan === null ? {} : { price_yuan: priceYuan }),
    ...(originalPriceYuan === null ? {} : { original_price_yuan: originalPriceYuan }),
    ...(currency === null ? {} : { currency }),
    ...(priceTexts === null ? {} : { price_texts: priceTexts, price_display: priceTexts[0] }),
    ...(salesDisplay === null ? {} : { sales_display: salesDisplay }),
    ...(parsedSales?.lowerBound === null || parsedSales?.lowerBound === undefined
      ? {} : { sales_lower_bound: parsedSales.lowerBound }),
    ...(parsedSales?.upperBound === null || parsedSales?.upperBound === undefined
      ? {} : { sales_upper_bound: parsedSales.upperBound }),
    ...(parsedSales === null ? {} : { sales_qualifier: parsedSales.qualifier }),
    ...(reviewDisplay === null ? {} : { review_display: reviewDisplay }),
    ...(reviewLowerBound === null ? {} : { review_count_lower_bound: reviewLowerBound }),
    ...(goodRate === null ? {} : { good_rate_percent: goodRate }),
    ...(imageUrl === null ? {} : { image_url: imageUrl }),
    ...(typeof value.isAd === "boolean" ? { is_ad: value.isAd } : {}),
  };
}

export function shouldEnrichGenericRecord(
  record: Pick<GenericNormalizedRecord, "contentText" | "recordKind" | "providerEntityId">,
  responseFamily: string,
): boolean {
  if (!record.contentText) return false;
  if (!/commerce_product/i.test(responseFamily)) return record.recordKind !== "metric";
  return record.recordKind === "product" && record.providerEntityId !== null;
}

function firstFiniteNumber(value: JsonObject, paths: string[][]): number | null {
  for (const path of paths) {
    const candidate = readPath(value, path);
    const parsed = typeof candidate === "number"
      ? candidate
      : typeof candidate === "string" && candidate.trim()
        ? Number(candidate.replaceAll(",", ""))
        : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function firstScalarText(value: JsonObject, paths: string[][]): string | null {
  for (const path of paths) {
    const candidate = readPath(value, path);
    if (typeof candidate === "string" && candidate.trim()) return candidate.normalize("NFKC").trim().slice(0, 500);
    if (typeof candidate === "number") return String(candidate);
  }
  return null;
}

function firstStringArray(value: JsonObject, paths: string[][]): string[] | null {
  for (const path of paths) {
    const candidate = readPath(value, path);
    if (!Array.isArray(candidate)) continue;
    const values = candidate
      .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
      .map((item) => String(item).normalize("NFKC").trim())
      .filter(Boolean)
      .slice(0, 20);
    if (values.length) return values;
  }
  return null;
}

function readPath(value: JsonObject, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, value);
}

function parseLocalizedCountLowerBound(value: string): number | null {
  const match = value.normalize("NFKC").replaceAll(",", "").match(/([0-9]+(?:\.[0-9]+)?)\s*(亿|万|千)?\s*\+?/);
  if (!match) return null;
  const amount = Number(match[1]);
  const multiplier = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : match[2] === "千" ? 1_000 : 1;
  const result = Math.floor(amount * multiplier);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function parseLocalizedSalesCount(value: string): {
  lowerBound: number | null;
  upperBound: number | null;
  qualifier: "exact" | "gte" | "range" | "unknown";
} | null {
  const normalized = value.normalize("NFKC").replaceAll(",", "").trim();
  if (!normalized) return null;
  const countPattern = /([0-9]+(?:\.[0-9]+)?)\s*(亿|万|千|พัน|หมื่น|แสน|ล้าน|ribu|juta|rb|jt|[kKmMbB])?/g;
  const matches = [...normalized.matchAll(countPattern)];
  if (!matches.length) return { lowerBound: null, upperBound: null, qualifier: "unknown" };
  const first = scaledCount(matches[0]?.[1], matches[0]?.[2]);
  if (first === null) return { lowerBound: null, upperBound: null, qualifier: "unknown" };
  const rangeLike = /[-–—~至到]/u.test(normalized);
  const second = rangeLike && matches[1] ? scaledCount(matches[1][1], matches[1][2]) : null;
  if (second !== null) {
    return { lowerBound: Math.min(first, second), upperBound: Math.max(first, second), qualifier: "range" };
  }
  const abbreviated = Boolean(matches[0]?.[2]);
  const lowerBoundOnly = abbreviated || /\+|以上|起|至少|กว่า|ขึ้นไป|มากกว่า|lebih\s+dari|at\s+least/i.test(normalized);
  return { lowerBound: first, upperBound: lowerBoundOnly ? null : first, qualifier: lowerBoundOnly ? "gte" : "exact" };
}

function scaledCount(amountText: string | undefined, suffixText: string | undefined): number | null {
  if (!amountText) return null;
  const amount = Number(amountText);
  const suffix = suffixText?.toLowerCase() ?? "";
  const multiplier = suffix === "亿" ? 100_000_000
    : suffix === "万" || suffix === "หมื่น" ? 10_000
      : suffix === "แสน" ? 100_000
        : suffix === "ล้าน" || suffix === "juta" || suffix === "jt" || suffix === "m" ? 1_000_000
          : suffix === "b" ? 1_000_000_000
            : suffix === "千" || suffix === "พัน" || suffix === "ribu" || suffix === "rb" || suffix === "k" ? 1_000
              : 1;
  const result = Math.floor(amount * multiplier);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function normalizeCurrency(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function defaultCommerceCurrency(platformId: string): string | null {
  return ["taobao", "jd", "1688", "douyin_ec", "xianyu"].includes(platformId) ? "CNY" : null;
}

function deepFirstString(value: unknown, keys: string[], depth = 0): string | null {
  const found = deepFirstValue(value, keys, depth);
  if (typeof found === "string" && found.trim()) return found.trim().slice(0, 20_000);
  if (typeof found === "number" || typeof found === "boolean") return String(found);
  return null;
}

function deepFirstIdentifier(value: unknown, keys: string[], depth = 0): string | null {
  if (!isRecord(value) || depth > 4) return null;
  const entries = Object.entries(value);
  for (const alias of keys) {
    const found = entries.find(([key]) => key.toLowerCase() === alias.toLowerCase());
    const normalized = normalizeIdentifier(found?.[1]);
    if (normalized) return normalized;
  }
  for (const child of Object.values(value)) {
    if (!isRecord(child)) continue;
    const nested = deepFirstIdentifier(child, keys, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).normalize("NFKC").trim();
  if (
    !normalized || normalized.length > 255 || Buffer.byteLength(normalized, "utf8") > 1_024 ||
    /[\s\u0000-\u001f\u007f]/u.test(normalized)
  ) return null;
  return normalized;
}

function deepFirstValue(value: unknown, keys: string[], depth = 0): unknown {
  if (!isRecord(value) || depth > 4) return null;
  for (const key of keys) if (value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key];
  for (const child of Object.values(value)) {
    if (!isRecord(child)) continue;
    const nested = deepFirstValue(child, keys, depth + 1);
    if (nested !== null && nested !== undefined && nested !== "") return nested;
  }
  return null;
}

function parseTime(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function validUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function compactText(parts: Array<string | null>): string | null {
  const text = [...new Set(parts.filter((part): part is string => Boolean(part?.trim())).map((part) => part.trim()))].join("；");
  return text ? text.slice(0, 4096) : null;
}

function rawJsonSha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
