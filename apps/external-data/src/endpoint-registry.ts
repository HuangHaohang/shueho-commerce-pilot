import type { PoolClient } from "pg";
import { Ajv, type ValidateFunction } from "ajv";

import { database } from "./database.js";
import { normalizeEndpointParams } from "./canonical.js";
import type { JsonObject, ProviderEndpoint } from "./types.js";

type EndpointRow = {
  endpoint_id: string;
  platform_id: string;
  platform_name: string;
  display_name: string;
  capability: string;
  api_path: string;
  http_method: "GET" | "POST";
  schema_version: string;
  request_schema: Record<string, unknown>;
  response_schema: Record<string, unknown>;
  request_codec: Record<string, unknown>;
  pagination_strategy: Record<string, unknown>;
  response_family: ProviderEndpoint["responseFamily"];
  normalizer_version: string;
  catalog_status: ProviderEndpoint["catalogStatus"];
  pricing_status: ProviderEndpoint["pricingStatus"];
  permission_status: ProviderEndpoint["permissionStatus"];
  enabled: boolean;
  documentation_url: string | null;
  openapi_url: string | null;
};

const validator = new Ajv({ allErrors: true, coerceTypes: true, useDefaults: true, strict: false, validateFormats: false });
const validatorCache = new Map<string, ValidateFunction>();

export async function listPlatforms(): Promise<Array<{ id: string; name: string; endpoint_count: number }>> {
  const result = await database.query<{ platform_id: string; platform_name: string; endpoint_count: string }>(`
    SELECT platform_id, max(platform_name) AS platform_name, count(*)::text AS endpoint_count
    FROM provider_endpoint
    WHERE enabled = true
    GROUP BY platform_id
    ORDER BY platform_id
  `);
  return result.rows.map((row) => ({
    id: row.platform_id,
    name: row.platform_name,
    endpoint_count: Number(row.endpoint_count),
  }));
}

export async function searchEndpoints(input: {
  query: string;
  platform?: string;
  limit: number;
}): Promise<ProviderEndpoint[]> {
  const terms = input.query
    .normalize("NFKC")
    .toLowerCase()
    .split(/[\s,，。/]+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 12);
  const result = await database.query<EndpointRow>(`
    SELECT endpoint_id, platform_id, platform_name, display_name, capability, api_path, http_method,
           schema_version, request_schema, response_schema, request_codec, pagination_strategy,
           response_family, normalizer_version, catalog_status, pricing_status, permission_status, enabled,
           documentation_url, openapi_url
    FROM provider_endpoint
    WHERE enabled = true
      AND ($1::text IS NULL OR platform_id = $1)
      AND (
        cardinality($2::text[]) = 0
        OR EXISTS (
          SELECT 1 FROM unnest($2::text[]) AS term
          WHERE lower(display_name || ' ' || capability || ' ' || endpoint_id || ' ' || api_path) LIKE '%' || term || '%'
        )
      )
    ORDER BY
      CASE WHEN lower(display_name || ' ' || capability) LIKE '%' || lower($3) || '%' THEN 0 ELSE 1 END,
      endpoint_id
    LIMIT $4
  `, [input.platform || null, terms, input.query, input.limit]);
  return result.rows.map(mapEndpointRow);
}

export async function listEnabledEndpoints(): Promise<ProviderEndpoint[]> {
  const result = await database.query<EndpointRow>(`
    SELECT endpoint_id, platform_id, platform_name, display_name, capability, api_path, http_method,
           schema_version, request_schema, response_schema, request_codec, pagination_strategy,
           response_family, normalizer_version, catalog_status, pricing_status, permission_status, enabled,
           documentation_url, openapi_url
    FROM provider_endpoint
    WHERE enabled = true
    ORDER BY endpoint_id
  `);
  return result.rows.map(mapEndpointRow);
}

export async function getEndpoint(endpointId: string, client?: PoolClient): Promise<ProviderEndpoint> {
  const executor = client ?? database;
  const result = await executor.query<EndpointRow>(`
    SELECT endpoint_id, platform_id, platform_name, display_name, capability, api_path, http_method,
           schema_version, request_schema, response_schema, request_codec, pagination_strategy,
           response_family, normalizer_version, catalog_status, pricing_status, permission_status, enabled,
           documentation_url, openapi_url
    FROM provider_endpoint
    WHERE endpoint_id = $1 AND enabled = true
    LIMIT 1
  `, [endpointId]);
  const row = result.rows[0];
  if (!row) throw new EndpointRegistryError(`Unknown or disabled endpoint ${endpointId}.`, "ENDPOINT_NOT_FOUND");
  return mapEndpointRow(row);
}

export async function providerCatalogHealth(): Promise<Record<string, unknown>> {
  const result = await database.query<{
    total: string; enabled: string; get_count: string; post_count: string;
    workflow_count: string; workflow_step_count: string; market_option_count: string;
    catalog_sha256: string | null; pricing_source_sha256: string | null; imported_at: Date | null;
  }>(`
    SELECT count(*)::text AS total,count(*) FILTER (WHERE endpoint.enabled)::text AS enabled,
           count(*) FILTER (WHERE endpoint.enabled AND http_method='GET')::text AS get_count,
           count(*) FILTER (WHERE endpoint.enabled AND http_method='POST')::text AS post_count,
           (SELECT count(*)::text FROM provider_business_workflow
             WHERE provider='justoneapi' AND status='active') AS workflow_count,
           (SELECT count(*)::text FROM provider_business_workflow_step step
             JOIN provider_business_workflow workflow ON workflow.workflow_id=step.workflow_id
             WHERE workflow.provider='justoneapi' AND workflow.status='active') AS workflow_step_count,
           (SELECT count(*)::text FROM provider_market_option
             WHERE provider='justoneapi' AND enabled=true) AS market_option_count,
           receipt.catalog_sha256,receipt.pricing_source_sha256,receipt.created_at AS imported_at
    FROM provider_endpoint endpoint
    LEFT JOIN LATERAL (
      SELECT catalog_sha256,pricing_source_sha256,created_at
      FROM provider_catalog_import_receipt WHERE provider='justoneapi'
      ORDER BY created_at DESC LIMIT 1
    ) receipt ON true
    WHERE endpoint.provider='justoneapi'
    GROUP BY receipt.catalog_sha256,receipt.pricing_source_sha256,receipt.created_at
  `);
  const row = result.rows[0];
  return {
    totalEndpoints: Number(row?.total ?? 0),
    callableEndpoints: Number(row?.enabled ?? 0),
    methods: { GET: Number(row?.get_count ?? 0), POST: Number(row?.post_count ?? 0) },
    businessWorkflows: Number(row?.workflow_count ?? 0),
    businessWorkflowSteps: Number(row?.workflow_step_count ?? 0),
    marketOptions: Number(row?.market_option_count ?? 0),
    catalogSha256: row?.catalog_sha256 ?? null,
    pricingSourceSha256: row?.pricing_source_sha256 ?? null,
    importedAt: row?.imported_at?.toISOString() ?? null,
  };
}

export class EndpointRegistryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "EndpointRegistryError";
  }
}

export function validateEndpointParams(endpoint: ProviderEndpoint, params: JsonObject): JsonObject {
  if (Object.keys(params).some((key) => /^(?:token|authorization|cookie|secret|password|api[_-]?key)$/i.test(key))) {
    throw new EndpointRegistryError("Provider credentials are not valid business parameters.", "CREDENTIAL_PARAMETER_DENIED");
  }
  const transformed = applyParameterTransforms(structuredClone(params), endpoint.requestCodec);
  const normalized = normalizeEndpointParams(endpoint.endpointId, transformed);
  const cacheKey = `${endpoint.endpointId}:${endpoint.schemaVersion}`;
  let validate = validatorCache.get(cacheKey);
  if (!validate) {
    const compiled = validator.compile(endpoint.requestSchema);
    validatorCache.set(cacheKey, compiled);
    validate = compiled;
  }
  if (!validate(normalized)) {
    const details = (validate.errors ?? []).slice(0, 8).map((error) => {
      const path = error.instancePath || "/";
      return `${path} ${error.message ?? error.keyword}`;
    }).join("; ");
    throw new EndpointRegistryError(`Endpoint parameters do not match the official OpenAPI schema: ${details}`.slice(0, 500), "INVALID_ENDPOINT_PARAMS");
  }
  return normalized;
}

function mapEndpointRow(row: EndpointRow): ProviderEndpoint {
  return {
    endpointId: row.endpoint_id,
    platformId: row.platform_id,
    platformName: row.platform_name,
    displayName: row.display_name,
    capability: row.capability,
    apiPath: row.api_path,
    httpMethod: row.http_method,
    schemaVersion: row.schema_version,
    requestSchema: row.request_schema,
    responseSchema: row.response_schema,
    requestCodec: row.request_codec,
    paginationStrategy: row.pagination_strategy,
    responseFamily: row.response_family,
    normalizerVersion: row.normalizer_version,
    catalogStatus: row.catalog_status,
    pricingStatus: row.pricing_status,
    permissionStatus: row.permission_status,
    enabled: row.enabled,
    documentationUrl: row.documentation_url,
    openapiUrl: row.openapi_url,
  };
}

function applyParameterTransforms(params: JsonObject, codec: JsonObject): JsonObject {
  const transforms = codec.transforms;
  if (!transforms || typeof transforms !== "object" || Array.isArray(transforms)) return params;
  for (const [key, transform] of Object.entries(transforms)) {
    if (transform === "provider_datetime" && typeof params[key] === "string") {
      params[key] = providerDateTime(params[key] as string, key);
    }
  }
  return params;
}

function providerDateTime(value: string, key: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed} ${/^end$/i.test(key) ? "23:59:59" : "00:00:00"}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed.replace("T", " ");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(parsed).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
