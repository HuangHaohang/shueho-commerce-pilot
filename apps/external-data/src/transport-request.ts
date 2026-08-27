import { canonicalJson, sha256Json, utf8JsonBytes } from "./canonical.js";
import type { JsonObject, ProviderEndpoint, ProviderTransportRequest } from "./types.js";

const DENIED_HEADER = /^(?:authorization|cookie|proxy-authorization|x-api-key)$/i;

export function buildProviderTransportRequest(
  endpoint: ProviderEndpoint,
  params: JsonObject,
): ProviderTransportRequest {
  const codec = endpoint.requestCodec;
  const queryKeys = stringArray(codec.query);
  const formKeys = stringArray(codec.form);
  const pathKeys = stringArray(codec.path);
  const headerKeys = stringArray(codec.header);
  const assigned = new Set([...queryKeys, ...formKeys, ...pathKeys, ...headerKeys]);
  if (!assigned.size) {
    for (const key of Object.keys(params)) (endpoint.httpMethod === "GET" ? queryKeys : formKeys).push(key);
  }
  const unknown = Object.keys(params).filter((key) => !new Set([...queryKeys, ...formKeys, ...pathKeys, ...headerKeys]).has(key));
  if (unknown.length) throw new Error(`Request codec does not place parameters: ${unknown.join(", ")}.`);

  const query = pick(params, queryKeys);
  const body = formKeys.length ? pick(params, formKeys) : null;
  const headers: Record<string, string> = {};
  for (const key of headerKeys) {
    if (DENIED_HEADER.test(key)) throw new Error(`Provider request header ${key} is not allowed.`);
    const value = params[key];
    if (value !== undefined && value !== null) headers[key] = scalarText(value);
  }
  let apiPath = endpoint.apiPath;
  for (const key of pathKeys) {
    const value = params[key];
    if (value === undefined || value === null || value === "") throw new Error(`Path parameter ${key} is required.`);
    apiPath = apiPath.replaceAll(`{${key}}`, encodeURIComponent(scalarText(value)));
  }
  if (/[{}]/.test(apiPath)) throw new Error(`Provider path contains unresolved parameters: ${apiPath}.`);

  const bodyContentType = typeof codec.bodyContentType === "string" ? codec.bodyContentType : null;
  const contentType = body
    ? bodyContentType ?? "application/x-www-form-urlencoded"
    : null;
  const bodyText = body
    ? contentType === "application/json"
      ? canonicalJson(body)
      : encodeFormBody(body)
    : null;
  const requestArtifact: JsonObject = {
    method: endpoint.httpMethod,
    path: apiPath,
    query,
    headers,
    contentType,
    body: bodyText,
  };
  return {
    apiPath,
    httpMethod: endpoint.httpMethod,
    query,
    headers,
    body,
    bodyText,
    contentType,
    requestArtifact,
    requestSha256: sha256Json(requestArtifact),
    requestBytes: utf8JsonBytes(requestArtifact),
  };
}

export function appendQueryValue(search: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    value.forEach((entry) => appendQueryValue(search, key, entry));
    return;
  }
  search.append(key, scalarText(value));
}

function encodeFormBody(body: JsonObject): string {
  const encoded = new URLSearchParams();
  for (const key of Object.keys(body).sort()) appendQueryValue(encoded, key, body[key]);
  return encoded.toString();
}

function pick(params: JsonObject, keys: string[]): JsonObject {
  return Object.fromEntries(keys.sort().flatMap((key) => params[key] === undefined ? [] : [[key, params[key]]]));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function scalarText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return canonicalJson(value);
}
