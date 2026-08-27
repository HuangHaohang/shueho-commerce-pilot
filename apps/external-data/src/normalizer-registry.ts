import { normalizeGenericPayload, type NormalizedGenericPayload } from "./generic-normalizer.js";
import { isDouyinContentListPayload, normalizeDouyinContentList } from "./douyin-content-normalizer.js";
import {
  normalizeSocialSearch,
  normalizeTaobaoSearch,
  type NormalizedSocialSearch,
  type NormalizedTaobaoSearch,
} from "./normalizers.js";
import type { JsonObject, ProviderEndpoint } from "./types.js";

export type RegisteredNormalization =
  | { kind: "taobao_search"; data: NormalizedTaobaoSearch }
  | { kind: "social_search"; data: NormalizedSocialSearch }
  | { kind: "generic"; data: NormalizedGenericPayload };

type RegisteredNormalizer = {
  family: string;
  normalize: (payload: JsonObject, endpoint: ProviderEndpoint) => RegisteredNormalization;
};

const normalizers = new Map<string, RegisteredNormalizer>([
  ["taobao_search_item_list_v1", {
    family: "taobao_search_item_list_v1",
    normalize: (payload) => ({ kind: "taobao_search", data: normalizeTaobaoSearch(payload) }),
  }],
  ["social_search_v1", {
    family: "social_search_v1",
    normalize: (payload) => ({ kind: "social_search", data: normalizeSocialSearch(payload) }),
  }],
]);

const genericNormalizer: RegisteredNormalizer = {
  family: "generic_json_v1",
  normalize: (payload, endpoint) => ({ kind: "generic", data: normalizeGenericPayload(payload, endpoint) }),
};

export function normalizeWithRegistry(endpoint: ProviderEndpoint, payload: JsonObject): RegisteredNormalization {
  if (isDouyinContentListPayload(payload)) {
    return { kind: "generic", data: normalizeDouyinContentList(payload, endpoint) };
  }
  return (normalizers.get(endpoint.responseFamily) ?? genericNormalizer).normalize(payload, endpoint);
}

export function registeredNormalizerFamily(endpoint: ProviderEndpoint): string {
  return (normalizers.get(endpoint.responseFamily) ?? genericNormalizer).family;
}
