import { createHash } from "node:crypto";

import type { JsonObject } from "./types.js";

export const JUSTONEAPI_ZH_SITEMAP_URL = "https://docs.justoneapi.com/zh/sitemap.xml";

export type PricingCatalogRow = {
  endpointId: string;
  platformId: string;
  platformName: string;
  apiPath: string;
  currency: string;
  vendorUnitCostMicros: number | null;
  permissionStatus: "allowed" | "unavailable";
  isActive: boolean;
};

export type ImportedCatalogEndpoint = {
  endpointId: string;
  platformId: string;
  platformName: string;
  displayName: string;
  capability: string;
  apiPath: string;
  httpMethod: "GET" | "POST";
  schemaVersion: string;
  requestSchema: JsonObject;
  responseSchema: JsonObject;
  requestCodec: JsonObject;
  paginationStrategy: JsonObject;
  responseFamily: string;
  normalizerVersion: string;
  documentationGroup: string | null;
  documentationUrl: string | null;
  openapiUrl: string | null;
  openapiSha256: string | null;
  operationId: string | null;
  catalogStatus: "active" | "deprecated" | "missing_openapi";
  pricingStatus: "priced" | "unavailable" | "missing";
  permissionStatus: "allowed" | "unavailable";
  currency: string | null;
  vendorUnitCostMicros: number | null;
  enabled: boolean;
};

export type DiscoveredOpenApi = {
  documentationGroup: string;
  documentationUrl: string;
  openapiUrl: string;
  openapiSha256: string;
  rawDocument: string;
  document: JsonObject;
};

export async function discoverJustOneApiCatalog(input: {
  sitemapUrl?: string;
  fetchImpl?: typeof fetch;
  concurrency?: number;
} = {}): Promise<{
  sitemapUrl: string;
  sitemapSha256: string;
  sitemapText: string;
  endpointPages: number;
  openapis: DiscoveredOpenApi[];
}> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sitemapUrl = input.sitemapUrl ?? JUSTONEAPI_ZH_SITEMAP_URL;
  const sitemapResponse = await fetchChecked(fetchImpl, sitemapUrl);
  const sitemapText = await sitemapResponse.text();
  const pageUrls = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1] ?? "")
    .filter((value) => endpointDocumentationIdentity(value) !== null)
    .sort();
  if (!pageUrls.length) throw new Error("JustOneAPI sitemap contains no endpoint documentation pages.");
  const openapis = await concurrentMap(pageUrls, input.concurrency ?? 12, async (documentationUrl) => {
    const identity = endpointDocumentationIdentity(documentationUrl);
    if (!identity) throw new Error(`Invalid endpoint documentation URL ${documentationUrl}.`);
    const page = await (await fetchChecked(fetchImpl, documentationUrl)).text();
    const match = page.match(/(?:https:\/\/docs\.justoneapi\.com)?\/openapi\/[A-Za-z0-9._\/-]+\.json/);
    if (!match?.[0]) throw new Error(`Documentation page has no OpenAPI definition: ${documentationUrl}`);
    const openapiUrl = new URL(match[0], documentationUrl).href;
    const response = await fetchChecked(fetchImpl, openapiUrl);
    const raw = await response.text();
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) throw new Error(`OpenAPI definition is not an object: ${openapiUrl}`);
    return {
      documentationGroup: identity.group,
      documentationUrl,
      openapiUrl,
      openapiSha256: sha256(raw),
      rawDocument: raw,
      document: parsed,
    };
  });
  return {
    sitemapUrl,
    sitemapSha256: sha256(sitemapText),
    sitemapText,
    endpointPages: pageUrls.length,
    openapis,
  };
}

export function mergeCatalog(input: {
  openapis: DiscoveredOpenApi[];
  pricingRows: PricingCatalogRow[];
}): ImportedCatalogEndpoint[] {
  const pricingByPath = new Map(input.pricingRows.map((row) => [row.apiPath, row]));
  const docsByPath = new Map<string, ImportedCatalogEndpoint>();
  for (const discovered of input.openapis) {
    const endpoint = endpointFromOpenApi(discovered, pricingByPath);
    const existing = docsByPath.get(endpoint.apiPath);
    if (existing && existing.openapiSha256 !== endpoint.openapiSha256) {
      throw new Error(`Conflicting OpenAPI definitions for ${endpoint.apiPath}.`);
    }
    docsByPath.set(endpoint.apiPath, endpoint);
  }
  for (const pricing of input.pricingRows) {
    if (docsByPath.has(pricing.apiPath)) continue;
    docsByPath.set(pricing.apiPath, {
      endpointId: pricing.endpointId,
      platformId: pricing.platformId,
      platformName: pricing.platformName,
      displayName: pricing.apiPath,
      capability: "Pricing master data contains this endpoint, but the current official documentation sitemap has no OpenAPI page.",
      apiPath: pricing.apiPath,
      httpMethod: "GET",
      schemaVersion: "missing-openapi-v1",
      requestSchema: { type: "object", additionalProperties: false, properties: {} },
      responseSchema: {},
      requestCodec: { query: [], form: [], path: [], header: [], bodyContentType: null },
      paginationStrategy: { requestKeys: [] },
      responseFamily: inferResponseFamily(pricing.apiPath),
      normalizerVersion: "generic-json-v1",
      documentationGroup: null,
      documentationUrl: null,
      openapiUrl: null,
      openapiSha256: null,
      operationId: null,
      catalogStatus: "missing_openapi",
      pricingStatus: pricing.permissionStatus === "allowed" && pricing.vendorUnitCostMicros !== null ? "priced" : "unavailable",
      permissionStatus: pricing.permissionStatus,
      currency: pricing.currency,
      vendorUnitCostMicros: pricing.vendorUnitCostMicros,
      enabled: false,
    });
  }
  return [...docsByPath.values()].sort((left, right) => left.endpointId.localeCompare(right.endpointId));
}

export function endpointFromOpenApi(
  discovered: DiscoveredOpenApi,
  pricingByPath: Map<string, PricingCatalogRow>,
): ImportedCatalogEndpoint {
  const operation = readSingleOperation(discovered.document);
  const pricing = pricingByPath.get(operation.apiPath);
  const identity = pricing ?? deriveEndpointIdentity(operation.apiPath);
  const request = buildRequestContract(discovered.document, operation.operation);
  applyEndpointRequestRules(operation.apiPath, request.schema);
  const responseSchema = readResponseSchema(discovered.document, operation.operation);
  const deprecated = operation.operation.deprecated === true || /(?:^|-)deprecated(?:$|-)/i.test(new URL(discovered.documentationUrl).pathname);
  const permissionStatus = pricing?.permissionStatus ?? "unavailable";
  const pricingStatus = !pricing
    ? "missing"
    : pricing.permissionStatus === "allowed" && pricing.vendorUnitCostMicros !== null
      ? "priced"
      : "unavailable";
  const responseFamily = specialResponseFamily(operation.apiPath) ?? inferResponseFamily(operation.apiPath);
  return {
    endpointId: identity.endpointId,
    platformId: identity.platformId,
    platformName: pricing?.platformName ?? platformNameForGroup(discovered.documentationGroup),
    displayName: textValue(discovered.document.info, "title") ?? textValue(operation.operation, "summary") ?? operation.apiPath,
    capability: textValue(operation.operation, "description") ?? textValue(operation.operation, "summary") ?? textValue(discovered.document.info, "description") ?? operation.apiPath,
    apiPath: operation.apiPath,
    httpMethod: operation.method,
    schemaVersion: `openapi-${discovered.openapiSha256.slice(0, 16)}`,
    requestSchema: request.schema,
    responseSchema,
    requestCodec: request.codec,
    paginationStrategy: inferPaginationStrategy(request.schema),
    responseFamily,
    normalizerVersion: responseFamily === "taobao_search_item_list_v1" || responseFamily === "social_search_v1"
      ? "1.0.0"
      : "generic-json-v1",
    documentationGroup: discovered.documentationGroup,
    documentationUrl: discovered.documentationUrl,
    openapiUrl: discovered.openapiUrl,
    openapiSha256: discovered.openapiSha256,
    operationId: typeof operation.operation.operationId === "string" ? operation.operation.operationId : null,
    catalogStatus: deprecated ? "deprecated" : "active",
    pricingStatus,
    permissionStatus,
    currency: pricing?.currency ?? null,
    vendorUnitCostMicros: pricing?.vendorUnitCostMicros ?? null,
    enabled: !deprecated && pricingStatus === "priced" && permissionStatus === "allowed" && pricing?.isActive === true,
  };
}

function applyEndpointRequestRules(apiPath: string, schema: JsonObject): void {
  if (apiPath === "/api/search/v1") {
    schema.allOf = [
      {
        if: { required: ["nextCursor"] },
        then: {},
        else: { required: ["start", "end"] },
      },
    ];
  }
}

function buildRequestContract(document: JsonObject, operation: JsonObject): { schema: JsonObject; codec: JsonObject } {
  const properties: JsonObject = {};
  const required = new Set<string>();
  const locations: Record<"query" | "form" | "path" | "header", string[]> = {
    query: [], form: [], path: [], header: [],
  };
  const transforms: Record<string, string> = {};
  for (const rawParameter of arrayValue(operation.parameters)) {
    const parameter = resolveMaybeRef(document, rawParameter);
    const name = typeof parameter.name === "string" ? parameter.name : "";
    const location = parameter.in;
    if (!name || name.toLowerCase() === "token") continue;
    if (location !== "query" && location !== "path" && location !== "header") continue;
    const parameterSchema = normalizeJsonSchema(resolveMaybeRef(document, parameter.schema));
    if (typeof parameter.description === "string" && /yyyy-MM-dd HH:mm:ss/i.test(parameter.description)) {
      parameterSchema.pattern = "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$";
      transforms[name] = "provider_datetime";
    }
    properties[name] = parameterSchema;
    locations[location].push(name);
    if (parameter.required === true) required.add(name);
  }
  const requestBody = resolveMaybeRef(document, operation.requestBody);
  const content = isRecord(requestBody.content) ? requestBody.content : {};
  const bodyContentType = ["application/x-www-form-urlencoded", "application/json"]
    .find((type) => isRecord(content[type])) ?? null;
  if (bodyContentType) {
    const media = content[bodyContentType] as JsonObject;
    const bodySchema = normalizeJsonSchema(resolveMaybeRef(document, media.schema));
    if (isRecord(bodySchema.properties)) {
      for (const [name, schema] of Object.entries(bodySchema.properties)) {
        if (name.toLowerCase() === "token") continue;
        properties[name] = schema;
        locations.form.push(name);
      }
    }
    for (const name of arrayValue(bodySchema.required).filter((value): value is string => typeof value === "string")) {
      if (name.toLowerCase() !== "token") required.add(name);
    }
  }
  for (const values of Object.values(locations)) values.sort();
  const schema: JsonObject = {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.size ? { required: [...required].sort() } : {}),
  };
  return {
    schema,
    codec: { ...locations, bodyContentType, transforms },
  };
}

function readResponseSchema(document: JsonObject, operation: JsonObject): JsonObject {
  const responses = isRecord(operation.responses) ? operation.responses : {};
  const response = resolveMaybeRef(document, responses["200"] ?? responses.default);
  const content = isRecord(response.content) ? response.content : {};
  const media = content["application/json"] ?? Object.values(content)[0];
  return isRecord(media) ? normalizeJsonSchema(resolveMaybeRef(document, media.schema)) : {};
}

function readSingleOperation(document: JsonObject): {
  apiPath: string;
  method: "GET" | "POST";
  operation: JsonObject;
} {
  const operations: Array<{ apiPath: string; method: "GET" | "POST"; operation: JsonObject }> = [];
  for (const [apiPath, rawItem] of Object.entries(isRecord(document.paths) ? document.paths : {})) {
    const item = isRecord(rawItem) ? rawItem : {};
    for (const method of ["get", "post"] as const) {
      if (isRecord(item[method])) operations.push({ apiPath, method: method.toUpperCase() as "GET" | "POST", operation: item[method] as JsonObject });
    }
  }
  if (operations.length !== 1) throw new Error(`OpenAPI document must contain exactly one GET or POST operation; found ${operations.length}.`);
  if (!/^\/api\/[A-Za-z0-9._/-]+$/.test(operations[0]!.apiPath)) throw new Error(`Unsafe JustOneAPI path ${operations[0]!.apiPath}.`);
  return operations[0]!;
}

function inferPaginationStrategy(schema: JsonObject): JsonObject {
  const properties = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  const requestKeys = properties.filter((key) => /^(?:page|pageNo|pageNum|currentPage|cursor|maxCursor|minCursor|nextCursor|offset|searchId|search_id|paginationToken|cookies_buffer)$/i.test(key));
  return { requestKeys: requestKeys.sort() };
}

function specialResponseFamily(apiPath: string): string | null {
  if (apiPath === "/api/search/v1") return "social_search_v1";
  if (apiPath === "/api/taobao/search-item-list/v1") return "taobao_search_item_list_v1";
  return null;
}

export function inferResponseFamily(apiPath: string): string {
  const normalized = apiPath.toLowerCase();
  if (/comment|reply|sub-comment|danmaku/.test(normalized)) return "comment";
  if (/product|item|sku|shop|store|catalog|category/.test(normalized)) return "commerce_product";
  if (/search-user|user-detail|user-profile|creator|account|channel|profile|employee/.test(normalized)) return "identity";
  if (/video|post|article|note|content|review|subtitle|caption/.test(normalized)) return "content";
  if (/metric|stat|trend|distribution|analysis|summary|performance|insight|ranking|price|sales|conversion|audience|follower|fan/.test(normalized)) return "metric";
  if (/search/.test(normalized)) return "content";
  if (/share-url|link|transfer|resolve/.test(normalized)) return "link_resolution";
  return "generic_json_v1";
}

function deriveEndpointIdentity(apiPath: string): { endpointId: string; platformId: string } {
  const parts = apiPath.trim().split("/").filter(Boolean);
  if (parts[0] !== "api" || parts.length < 3 || !parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error(`Invalid JustOneAPI path ${apiPath}.`);
  }
  const versionPart = parts.at(-1) ?? "";
  const hasVersion = /^v\d+$/i.test(versionPart);
  const platformId = snake(parts[1] ?? "");
  const action = parts.slice(2, hasVersion ? -1 : undefined).map(snake).join("_");
  const version = hasVersion ? versionPart.toLowerCase() : "v1";
  return { endpointId: `${platformId}.${`${action}_${version}`.replace(/_+/g, "_")}`, platformId };
}

function endpointDocumentationIdentity(value: string): { group: string; slug: string } | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== "https://docs.justoneapi.com") return null;
  const match = url.pathname.match(/^\/zh\/api\/([^/]+)\/([^/]+)$/);
  return match ? { group: match[1]!, slug: match[2]! } : null;
}

function platformNameForGroup(group: string): string {
  const names: Record<string, string> = {
    "taobao-and-tmall": "淘宝和天猫", "xiaohongshu-rednote": "小红书", "xiaohongshu-e-commerce-rednote": "小红书电商",
    "xiaohongshu-creator-marketplace-pugongying": "小红书蒲公英", "douyin-tiktok-china": "抖音", "douyin-e-commerce": "抖音电商",
    "douyin-creator-marketplace-xingtu": "抖音巨量星图", "wechat-official-accounts": "微信公众号", "wechat-channels": "微信视频号",
    "qq-huxuan-creator-marketplace": "腾讯互选", "douban-movie": "豆瓣电影", "dewu-poizon": "得物", "xianyu-goofish": "闲鱼",
    "social-media": "跨平台社交媒体", "jdcom": "京东",
  };
  return names[group] ?? group;
}

function normalizeJsonSchema(value: unknown, depth = 0): JsonObject {
  if (!isRecord(value) || depth > 20) return {};
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" || key === "example" || key === "examples" || key === "xml") continue;
    if (key === "properties" && isRecord(child)) {
      result.properties = Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, normalizeJsonSchema(schema, depth + 1)]));
    } else if (key === "items") {
      result.items = normalizeJsonSchema(child, depth + 1);
    } else if (key === "allOf" || key === "anyOf" || key === "oneOf") {
      result[key] = arrayValue(child).map((item) => normalizeJsonSchema(item, depth + 1));
    } else {
      result[key] = child;
    }
  }
  if (result.nullable === true && typeof result.type === "string") result.type = [result.type, "null"];
  delete result.nullable;
  normalizeEnumDefault(result);
  return result;
}

function normalizeEnumDefault(schema: JsonObject): void {
  if (!Array.isArray(schema.enum) || schema.default === undefined) return;
  if (schema.enum.some((value) => Object.is(value, schema.default))) return;
  if (typeof schema.default === "string") {
    const caseMatch = schema.enum.find((value) => typeof value === "string" && value.toLowerCase() === String(schema.default).toLowerCase());
    if (caseMatch !== undefined) {
      schema.default = caseMatch;
      return;
    }
    const suffixMatch = schema.enum.find((value) => typeof value === "string" && value.endsWith(`_${schema.default}`));
    if (suffixMatch !== undefined) {
      schema.default = suffixMatch;
      return;
    }
  }
  delete schema.default;
}

function resolveMaybeRef(document: JsonObject, value: unknown, seen = new Set<string>()): JsonObject {
  if (!isRecord(value)) return {};
  if (typeof value.$ref !== "string") return value;
  if (!value.$ref.startsWith("#/")) throw new Error(`External OpenAPI refs are not supported: ${value.$ref}`);
  if (seen.has(value.$ref)) return {};
  seen.add(value.$ref);
  const resolved = value.$ref.split("/").slice(1).reduce<unknown>((current, segment) => {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    return isRecord(current) ? current[key] : undefined;
  }, document);
  return resolveMaybeRef(document, resolved, seen);
}

async function fetchChecked(fetchImpl: typeof fetch, url: string): Promise<Response> {
  const response = await fetchImpl(url, { headers: { Accept: "application/json,text/html,application/xml", "User-Agent": "SHUEHO-Catalog-Importer/0.1" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Unable to fetch ${url}: HTTP ${response.status}.`);
  return response;
}

async function concurrentMap<T, R>(values: T[], concurrency: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      output[index] = await worker(values[index]!);
    }
  }));
  return output;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function catalogSha256(value: unknown): string {
  return sha256(stableJson(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function snake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s\-./]+/g, "_").replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function textValue(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" && value[key].trim() ? value[key].trim() : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
