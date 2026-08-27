import { sha256Json } from "./canonical.js";
import { assessTaobaoItemQuality, assessTextQuality, parseSalesDisplay } from "./quality.js";
import type { JsonObject, QualityDecision } from "./types.js";

export type NormalizedTaobaoItem = {
  ordinal: number;
  itemId: string | null;
  productId: string | null;
  spuId: string | null;
  shopId: string | null;
  itemNameRaw: string | null;
  itemSubNameRaw: string | null;
  shopNameRaw: string | null;
  itemType: string | null;
  tmall: boolean | null;
  itemLocation: string | null;
  sellerLocation: string | null;
  imageUrl: string | null;
  imageUrls: unknown[];
  priceFen: number | null;
  discountedPriceFen: number | null;
  priceYuan: number | null;
  discountedPriceYuan: number | null;
  discountRate: number | null;
  discountType: string | null;
  salesDisplay: string | null;
  salesLowerBound: number | null;
  salesUpperBound: number | null;
  salesQualifier: "exact" | "gte" | "range" | "unknown" | null;
  stock: number | null;
  commentCount: string | null;
  itemGrade: number | null;
  sellerGoodRate: number | null;
  sellerLevel: number | null;
  descriptionDsr: string | null;
  serviceDsr: string | null;
  shippingDsr: string | null;
  tags: unknown[];
  services: unknown[];
  extraMap: JsonObject;
  rawData: JsonObject;
  rawSha256: string;
  quality: QualityDecision;
};

export type NormalizedTaobaoBrand = {
  ordinal: number;
  brandId: string | null;
  brandNameRaw: string | null;
  itemCount: number | null;
  rawData: JsonObject;
  quality: QualityDecision;
};

export type NormalizedTaobaoProperty = {
  ordinal: number;
  propertyId: string | null;
  propertyNameRaw: string | null;
  flag: string | null;
  rawData: JsonObject;
  quality: QualityDecision;
  values: Array<{
    ordinal: number;
    valueId: string | null;
    valueNameRaw: string | null;
    itemCount: number | null;
    flag: string | null;
    rawData: JsonObject;
    quality: QualityDecision;
  }>;
};

export type NormalizedTaobaoSearch = {
  providerPayload: JsonObject;
  model: JsonObject;
  page: JsonObject;
  items: NormalizedTaobaoItem[];
  brands: NormalizedTaobaoBrand[];
  properties: NormalizedTaobaoProperty[];
  traces: unknown[];
  providerSuccess: boolean | null;
  responseStatus: number | null;
  costMillis: number | null;
  modelExtraMap: JsonObject;
  dataExtraMap: JsonObject;
};

export type NormalizedSocialSearch = {
  providerPayload: JsonObject;
  rawData: unknown;
  items: Array<{
    ordinal: number;
    providerEntityId: string | null;
    sourceName: string | null;
    sourcePlatform: string | null;
    titleRaw: string | null;
    summaryRaw: string | null;
    authorRaw: string | null;
    canonicalUrl: string | null;
    publishedAt: string | null;
    metrics: JsonObject;
    rawData: JsonObject;
    rawSha256: string;
    quality: QualityDecision;
  }>;
  nextCursor: string | null;
};

export function normalizeTaobaoSearch(payload: JsonObject): NormalizedTaobaoSearch {
  const providerPayload = unwrapProviderPayload(payload);
  const data = record(providerPayload.data);
  const model = record(data.model);
  if (!Object.keys(model).length) throw new NormalizationError("Taobao response is missing data.model.", "TAOBAO_MODEL_MISSING");
  const items = array(model.itemList).map((value, ordinal) => normalizeTaobaoItem(record(value), ordinal));
  const brands = array(model.brandList).map((value, ordinal) => normalizeTaobaoBrand(record(value), ordinal));
  const properties = array(model.propertyList).map((value, ordinal) => normalizeTaobaoProperty(record(value), ordinal));
  return {
    providerPayload,
    model,
    page: record(model.page),
    items,
    brands,
    properties,
    traces: array(model.traceList),
    providerSuccess: booleanValue(model.success),
    responseStatus: integerValue(model.responseStatus),
    costMillis: integerValue(model.costMillis),
    modelExtraMap: record(model.extraMap),
    dataExtraMap: record(data.extraMap),
  };
}

export function normalizeSocialSearch(payload: JsonObject): NormalizedSocialSearch {
  const providerPayload = unwrapProviderPayload(payload);
  const rawData = providerPayload.data;
  const candidates = locateSocialItems(rawData);
  return {
    providerPayload,
    rawData,
    items: candidates.map((value, ordinal) => {
      const item = record(value);
      const title = firstString(item, ["title", "name", "contentTitle", "noteTitle"]);
      const summary = firstString(item, ["summary", "description", "content", "text", "abstract"]);
      const quality = assessTextQuality(title ?? summary, { maxLength: 20_000, allowEmpty: false, field: "socialItem" });
      return {
        ordinal,
        providerEntityId: idValue(item.id ?? item.itemId ?? item.item_id ?? item.videoId ?? item.video_id ?? item.awemeId ?? item.aweme_id),
        sourceName: firstString(item, ["sourceName", "source_name", "siteName", "site"]),
        sourcePlatform: firstString(item, ["source", "platform", "channel"]),
        titleRaw: title,
        summaryRaw: summary,
        authorRaw: firstString(item, ["author", "authorName", "nickname", "userName"]),
        canonicalUrl: firstString(item, ["url", "link", "articleUrl", "noteUrl"]),
        publishedAt: parseTime(firstString(item, ["publishTime", "publishedAt", "date", "time", "createTime"])),
        metrics: extractSocialMetrics(item),
        rawData: item,
        rawSha256: sha256Json(item),
        quality,
      };
    }),
    nextCursor: firstString(record(rawData), ["nextCursor", "next_cursor", "cursor"]),
  };
}

export function unwrapProviderPayload(payload: JsonObject): JsonObject {
  const raw = record(payload.raw);
  return typeof raw.code === "number" && "data" in raw ? raw : payload;
}

export class NormalizationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "NormalizationError";
  }
}

function normalizeTaobaoItem(item: JsonObject, ordinal: number): NormalizedTaobaoItem {
  const sales = parseSalesDisplay(item.orderPayUV);
  return {
    ordinal,
    itemId: idValue(item.itemId),
    productId: idValue(item.prodId),
    spuId: idValue(item.spuId),
    shopId: idValue(item.shopId),
    itemNameRaw: stringValue(item.itemName),
    itemSubNameRaw: stringValue(item.itemSubName),
    shopNameRaw: stringValue(item.shopName),
    itemType: stringValue(item.itemType),
    tmall: integerValue(item.userType) === null ? null : integerValue(item.userType) === 1,
    itemLocation: stringValue(item.itemLoc),
    sellerLocation: stringValue(item.sellerLoc),
    imageUrl: stringValue(item.picUrlFull) ?? stringValue(item.picUrl),
    imageUrls: array(item.picUrlList),
    priceFen: integerValue(item.priceFen),
    discountedPriceFen: integerValue(item.priceZKFen),
    priceYuan: numberValue(item.priceYuanDouble),
    discountedPriceYuan: numberValue(item.priceZKYuanDouble ?? item.discntPriceYuan),
    discountRate: numberValue(item.discntRate),
    discountType: stringValue(item.discntType),
    salesDisplay: sales.display,
    salesLowerBound: sales.lowerBound,
    salesUpperBound: sales.upperBound,
    salesQualifier: sales.qualifier,
    stock: integerValue(item.frontStock),
    commentCount: stringValue(item.commentCount),
    itemGrade: numberValue(item.itemGradeAvg),
    sellerGoodRate: numberValue(item.sellerGoodrat),
    sellerLevel: integerValue(item.sellerLevel),
    descriptionDsr: stringValue(item.miaoshuDsr),
    serviceDsr: stringValue(item.fuwuDsr),
    shippingDsr: stringValue(item.fahuoDsr),
    tags: [...array(item.tagList), ...array(item.tmcTagList)],
    services: array(item.serviceList),
    extraMap: record(item.extraMap),
    rawData: item,
    rawSha256: sha256Json(item),
    quality: assessTaobaoItemQuality(item),
  };
}

function normalizeTaobaoBrand(brand: JsonObject, ordinal: number): NormalizedTaobaoBrand {
  return {
    ordinal,
    brandId: idValue(brand.brandId),
    brandNameRaw: stringValue(brand.brandName),
    itemCount: integerValue(brand.count),
    rawData: brand,
    quality: assessTextQuality(brand.brandName, { maxLength: 256, allowEmpty: false, field: "brandName" }),
  };
}

function normalizeTaobaoProperty(property: JsonObject, ordinal: number): NormalizedTaobaoProperty {
  const values = array(property.valueList).map((value, valueOrdinal) => {
    const row = record(value);
    return {
      ordinal: valueOrdinal,
      valueId: idValue(row.vid),
      valueNameRaw: stringValue(row.vname),
      itemCount: integerValue(row.count),
      flag: stringValue(row.flag),
      rawData: row,
      quality: assessTextQuality(row.vname, { maxLength: 256, allowEmpty: false, field: "propertyValue" }),
    };
  });
  return {
    ordinal,
    propertyId: idValue(property.pid),
    propertyNameRaw: stringValue(property.pname),
    flag: stringValue(property.flag),
    rawData: property,
    quality: assessTextQuality(property.pname, { maxLength: 128, allowEmpty: false, field: "propertyName" }),
    values,
  };
}

function locateSocialItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const object = record(value);
  for (const key of ["items", "list", "records", "results", "data", "contentList", "content_list"]) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return Object.keys(object).length ? [object] : [];
}

function firstString(value: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = stringValue(value[key]);
    if (candidate) return candidate;
  }
  return null;
}

function parseTime(value: string | null): string | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? new Date(`${value.replace(" ", "T")}+08:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractSocialMetrics(value: JsonObject, depth = 0): JsonObject {
  if (depth > 3) return {};
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    const metric = canonicalSocialMetric(key);
    const numeric = metric ? numberValue(child) : null;
    if (metric && numeric !== null && result[metric] === undefined) result[metric] = numeric;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const nested = extractSocialMetrics(child as JsonObject, depth + 1);
      for (const [metricName, metricValue] of Object.entries(nested)) {
        if (result[metricName] === undefined) result[metricName] = metricValue;
      }
    }
  }
  return result;
}

function canonicalSocialMetric(key: string): "views" | "likes" | "comments" | "shares" | "interactions" | null {
  const normalized = key.toLowerCase();
  if (/rate|ratio|score/.test(normalized)) return null;
  if (/interact/.test(normalized)) return "interactions";
  if (/comment/.test(normalized)) return "comments";
  if (/share/.test(normalized)) return "shares";
  if (/like|digg/.test(normalized)) return "likes";
  if (/view|play|vv/.test(normalized)) return "views";
  return null;
}

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function idValue(value: unknown): string | null {
  if (typeof value === "string" && value.length <= 128) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "bigint") return value.toString();
  return null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
