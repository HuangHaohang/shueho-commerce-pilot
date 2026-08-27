import { assessTextQuality } from "./quality.js";
import {
  normalizeGenericPayload,
  type GenericNormalizedRecord,
  type NormalizedGenericPayload,
} from "./generic-normalizer.js";
import type { JsonObject, ProviderEndpoint } from "./types.js";

export function isDouyinContentListPayload(payload: JsonObject): boolean {
  const data = record(record(payload.raw).data ?? payload.data);
  const content = Array.isArray(data.content_list) ? data.content_list : [];
  return content.some((item) => {
    const row = record(item);
    return Boolean(text(record(row.attribute_datas).item_title) && identifier(row.id));
  });
}

export function normalizeDouyinContentList(
  payload: JsonObject,
  endpoint: ProviderEndpoint,
): NormalizedGenericPayload {
  const normalized = normalizeGenericPayload(payload, endpoint);
  return {
    ...normalized,
    records: normalized.records.map((source) => normalizeContentRecord(source)),
  };
}

function normalizeContentRecord(source: GenericNormalizedRecord): GenericNormalizedRecord {
  if (!/^\/data\/content_list\/\d+$/.test(source.jsonPointer)) return source;
  const row = record(source.rawData);
  const attributes = record(row.attribute_datas);
  const user = record(row.user_info);
  const providerEntityId = identifier(row.id);
  const title = text(attributes.item_title);
  if (!providerEntityId || !title) return source;
  const author = text(user.name);
  const publishedAt = epochSeconds(attributes.item_create_time);
  const metrics = compactObject({
    views: numeric(attributes.vv_all),
    interactions: numeric(attributes.interact_cnt),
    likes: numeric(attributes.like_cnt_all),
    comments: numeric(attributes.comment_cnt_all),
    shares: numeric(attributes.share_cnt_all),
    interaction_rate: numeric(attributes.interact_rate),
    finish_rate: numeric(attributes.finish_rate),
    quality_score: numeric(attributes.quality_score),
    provider_score: numeric(attributes.score),
    followers: numeric(user.follower),
  });
  return {
    ...source,
    recordKind: "content",
    providerEntityId,
    titleRaw: title,
    summaryRaw: null,
    authorRaw: author,
    canonicalUrl: `https://www.douyin.com/video/${encodeURIComponent(providerEntityId)}`,
    publishedAt,
    contentText: [title, author].filter(Boolean).join("；").slice(0, 4096),
    metrics,
    quality: assessTextQuality(title, { maxLength: 20_000, allowEmpty: false, field: "douyinContentTitle" }),
    supportsPrice: false,
    supportsSales: false,
  };
}

function epochSeconds(value: unknown): string | null {
  const parsed = numeric(value);
  if (parsed === null || !Number.isSafeInteger(parsed) || parsed <= 0) return null;
  const date = new Date(parsed * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function compactObject(value: Record<string, number | null>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => entry[1] !== null));
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim() && value.length <= 128) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
