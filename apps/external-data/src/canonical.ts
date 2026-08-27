import { createHash } from "node:crypto";

import type {
  ExternalDataBusinessIntent,
  JsonObject,
  QueryIdentity,
  ResearchIntent,
} from "./types.js";

const DEFAULT_PAGINATION_KEYS = ["page", "nextCursor", "cursor", "pageSize", "page_size"];

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

export function buildQueryIdentity(input: {
  endpointId: string;
  schemaVersion: string;
  platform: string;
  params: JsonObject;
  requestText: string;
  topN: number;
  paginationKeys?: string[];
  businessIntent?: ExternalDataBusinessIntent | null;
}): QueryIdentity {
  const normalizedParams = normalizeEndpointParams(input.endpointId, input.params);
  const canonicalQueryParams: JsonObject = {};
  const paginationParams: JsonObject = {};
  const paginationKeys = new Set(input.paginationKeys?.length ? input.paginationKeys : DEFAULT_PAGINATION_KEYS);
  for (const [key, value] of Object.entries(normalizedParams)) {
    (paginationKeys.has(key) ? paginationParams : canonicalQueryParams)[key] = value;
  }
  canonicalQueryParams.top_n = input.topN;
  const intent = buildResearchIntent({
    endpointId: input.endpointId,
    platform: input.platform,
    requestText: input.requestText,
    params: normalizedParams,
    topN: input.topN,
    businessIntent: input.businessIntent,
  });
  const { originalRequest: _originalRequest, ...stableIntent } = intent;
  return {
    intent,
    intentKey: sha256Json({ schema_version: 1, ...stableIntent }),
    queryKey: sha256Json({
      schema_version: 1,
      endpoint_id: input.endpointId,
      endpoint_schema_version: input.schemaVersion,
      params: canonicalQueryParams,
    }),
    pageKey: sha256Json({
      schema_version: 1,
      endpoint_id: input.endpointId,
      endpoint_schema_version: input.schemaVersion,
      params: canonicalQueryParams,
      pagination: paginationParams,
    }),
    canonicalQueryParams,
    paginationParams,
  };
}

export function normalizeEndpointParams(endpointId: string, params: JsonObject): JsonObject {
  const normalized = canonicalize(params) as JsonObject;
  if (endpointId === "taobao.search_item_list_v1") {
    return {
      keyword: normalizeText(normalized.keyword),
      sort: typeof normalized.sort === "string" && normalized.sort ? normalized.sort : "_sale",
      tmall: normalized.tmall === true,
      ...(normalized.startPrice === undefined || normalized.startPrice === null ? {} : { startPrice: String(normalized.startPrice) }),
      ...(normalized.endPrice === undefined || normalized.endPrice === null ? {} : { endPrice: String(normalized.endPrice) }),
      page: normalizePositiveInteger(normalized.page, 1),
      ...unknownParams(normalized, new Set(["keyword", "sort", "tmall", "startPrice", "endPrice", "page"])),
    };
  }
  if (endpointId === "search.search_v1") {
    return {
      ...(normalized.keyword === undefined ? {} : { keyword: normalizeText(normalized.keyword) }),
      source: typeof normalized.source === "string" && normalized.source ? normalized.source.toUpperCase() : "ALL",
      ...(normalized.start === undefined ? {} : { start: normalizeText(normalized.start) }),
      ...(normalized.end === undefined ? {} : { end: normalizeText(normalized.end) }),
      ...(normalized.nextCursor === undefined ? {} : { nextCursor: normalizeText(normalized.nextCursor) }),
      ...unknownParams(normalized, new Set(["keyword", "source", "start", "end", "nextCursor"])),
    };
  }
  return normalized;
}

function buildResearchIntent(input: {
  endpointId: string;
  platform: string;
  requestText: string;
  params: JsonObject;
  topN: number;
  businessIntent?: ExternalDataBusinessIntent | null;
}): ResearchIntent {
  const request = input.requestText.trim();
  const metrics = new Set<string>();
  for (const metric of input.businessIntent?.requestedMetrics ?? []) metrics.add(metric);
  if (!metrics.size) {
    if (/价格|价格带|售价|客单/.test(request)) metrics.add("price_band");
    if (/销量|销售量|卖得好|热销|成交/.test(request)) metrics.add("sales_level");
    if (/品牌|竞品|竞争/.test(request)) metrics.add("brand_competition");
    if (/属性|材质|尺寸|用途|风格/.test(request)) metrics.add("property_distribution");
  }
  if (!metrics.size) metrics.add("market_overview");
  const keywordKey = ["keyword", "query", "q", "searchKeyword", "searchText", "name"]
    .find((key) => typeof input.params[key] === "string" && String(input.params[key]).trim());
  const keyword = input.businessIntent?.targetProduct ?? (keywordKey ? String(input.params[keywordKey]).trim() : null);
  return {
    platform: input.businessIntent?.platform ?? input.platform,
    targetProduct: keyword || null,
    metrics: [...metrics].sort(),
    expectedCategories: keyword ? [keyword] : [],
    excludedCategories: [],
    currency: input.endpointId.startsWith("taobao.") ? "CNY" : null,
    requestedTopN: input.businessIntent?.requestedTopN ?? input.topN,
    originalRequest: request,
    ...(input.businessIntent ? {
      objective: input.businessIntent.objective,
      timeRange: input.businessIntent.timeRange,
      windowEnforcement: input.businessIntent.windowEnforcement,
      ...(input.businessIntent.localizedKeyword
        ? { localizedKeyword: input.businessIntent.localizedKeyword }
        : {}),
    } : {}),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return value.normalize("NFKC").trim().replace(/\s+/g, " ");
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function unknownParams(params: JsonObject, known: Set<string>): JsonObject {
  return Object.fromEntries(Object.entries(params).filter(([key]) => !known.has(key)));
}
