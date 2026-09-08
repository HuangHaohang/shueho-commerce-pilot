import { createHash } from "node:crypto";
import { database } from "./database.js";
import { getJustOneApiClient } from "./justoneapi-runtime.js";
import type { JsonObject } from "./types.js";

export type DataCapabilityAuthorization = { allowedCatalogPlatforms?: string[]; allowedEndpointIds?: string[] };
export type DataCapabilityRow = {
  endpoint_id: string; platform_id: string; platform_name: string; display_name: string; capability: string;
  api_path: string; http_method: string; enabled: boolean; catalog_status: string; pricing_status: string;
  permission_status: string; request_schema: JsonObject; request_codec: JsonObject; response_family: string;
  source_catalog_import_id: string | null; openapi_sha256: string | null;
  market_options?: JsonObject[];
  quota_pairs: number; quota_ready: number; quota_remaining: string | null;
};

export class DataCapabilityError extends Error {
  constructor(message: string, readonly code: string, readonly details: JsonObject = {}) { super(message); this.name = "DataCapabilityError"; }
}

export function capabilityId(endpointId: string): string {
  return `cap_${createHash("sha256").update(endpointId).digest("hex").slice(0,24)}`;
}

export function capabilityRevision(row: DataCapabilityRow): string {
  return createHash("sha256").update(JSON.stringify([
    row.source_catalog_import_id,row.openapi_sha256,row.request_schema,row.request_codec,row.http_method,
  ])).digest("hex");
}

export function isProtectedField(name: string): boolean {
  return /(?:^|[_-])(?:token|password|passwd|secret|authorization|cookie|api[_-]?key|access[_-]?key|private[_-]?key)(?:$|[_-])/i.test(name) ||
    /^(?:accessToken|apiKey|clientSecret|refreshToken)$/i.test(name);
}

export function capabilityView(row: DataCapabilityRow, authorization: DataCapabilityAuthorization, schema = false): JsonObject {
  const workspaceAllowed = (!authorization.allowedCatalogPlatforms?.length || authorization.allowedCatalogPlatforms.includes(row.platform_id)) &&
    (!authorization.allowedEndpointIds?.length || authorization.allowedEndpointIds.includes(row.endpoint_id));
  const required = Array.isArray(row.request_schema.required) ? row.request_schema.required.filter((key): key is string => typeof key === "string") : [];
  const protectedInput = required.some(isProtectedField);
  const reasons = [
    ...(!["active","legacy"].includes(row.catalog_status) ? [`CATALOG_${row.catalog_status.toUpperCase()}`] : []),
    ...(row.pricing_status !== "priced" ? ["PRICING_UNAVAILABLE"] : []),
    ...(row.permission_status !== "allowed" ? ["PROVIDER_PERMISSION_UNAVAILABLE"] : []),
    ...(!workspaceAllowed ? ["WORKSPACE_PERMISSION_DENIED"] : []),
    ...(protectedInput ? ["PROTECTED_INPUT_REQUIRED"] : []),
    ...(!row.enabled && row.catalog_status === "active" && row.pricing_status === "priced" && row.permission_status === "allowed" ? ["CAPABILITY_DISABLED"] : []),
    ...(row.quota_pairs === 0 ? ["TOKEN_QUOTA_UNCONFIGURED"] : row.quota_ready === 0 ? ["TOKEN_QUOTA_UNAVAILABLE"] : []),
  ];
  const text = `${row.platform_name} ${row.display_name} ${row.capability}`;
  const category = /\bAI\b|\bLLM\b|人工智能|语言模型/i.test(text) ? "ai_answers"
    : /commerce|taobao_search_item/.test(row.response_family) ? "commerce_data"
    : /content|comment|social/.test(row.response_family) ? "social_content"
    : /identity/.test(row.response_family) ? "profiles" : /metric/.test(row.response_family) ? "metrics" : "other_data";
  const properties = object(row.request_schema.properties);
  return {
    capability_id: capabilityId(row.endpoint_id), name: row.display_name.startsWith("/api/") ? `${row.platform_name} 已登记数据能力` : row.display_name,
    platform: row.platform_id, platform_name: row.platform_name, category, description: row.capability,
    registered: true, executable: reasons.length === 0, blocking_reasons: reasons,
    availability: { catalog: row.catalog_status, pricing: row.pricing_status, provider_permission: row.permission_status,
      workspace_authorized: workspaceAllowed, local_quota: row.quota_pairs === 0 ? "unconfigured" : row.quota_ready > 0 ? "available" : "unavailable" },
    ...(schema ? {
      revision: capabilityRevision(row),market_options:row.market_options ?? [], input_schema: {
        ...row.request_schema, properties: Object.fromEntries(Object.entries(properties).filter(([key]) => !isProtectedField(key))),
        required: required.filter((key) => !isProtectedField(key)),
      },
      execution: { plan_tool: "plan_data_request", execute_tool: "execute_data_request", provider_calls: 1 },
      result_contract: "Validated, bounded source-field observations with provenance; provider outputs are not independently verified business facts.",
    } : {}),
  };
}

async function catalogRows(): Promise<DataCapabilityRow[]> {
  const tokenIds = await getJustOneApiClient().configuredCredentialIds().catch(() => []);
  const result = await database.query<DataCapabilityRow>(`
    SELECT endpoint.endpoint_id,endpoint.platform_id,endpoint.platform_name,endpoint.display_name,endpoint.capability,
      endpoint.api_path,endpoint.http_method,endpoint.enabled,endpoint.catalog_status,endpoint.pricing_status,
      endpoint.permission_status,endpoint.request_schema,endpoint.request_codec,endpoint.response_family,
      endpoint.source_catalog_import_id,endpoint.openapi_sha256,
      count(quota.token_id)::int AS quota_pairs,
      count(quota.token_id) FILTER(WHERE quota.state='active' AND quota.remaining_calls>0 AND token.state='active')::int AS quota_ready,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('parameter',option.parameter_name,'code',option.market_code,'label',option.display_name,
        'ready',option.localization_ready AND profile.id IS NOT NULL,'query_locales',profile.query_locales,'currency',profile.currency,'timezone',profile.timezone)
        ORDER BY option.parameter_name,option.sort_order)
        FROM provider_market_option option LEFT JOIN provider_market_profile profile ON profile.id=option.market_profile_id AND profile.enabled
        WHERE option.endpoint_id=endpoint.endpoint_id AND option.enabled),'[]'::jsonb) AS market_options,
      sum(quota.remaining_calls)::text AS quota_remaining
    FROM provider_endpoint endpoint
    LEFT JOIN justoneapi_token_endpoint_quota quota ON quota.api_path=endpoint.api_path AND quota.token_id=ANY($1::text[])
    LEFT JOIN justoneapi_token token ON token.token_id=quota.token_id
    WHERE endpoint.provider='justoneapi'
    GROUP BY endpoint.endpoint_id ORDER BY endpoint.platform_id,endpoint.display_name,endpoint.endpoint_id`, [tokenIds]);
  return result.rows;
}

export async function searchDataCapabilities(input: { query?: string; platform?: string; offset?: number; limit?: number }, authorization: DataCapabilityAuthorization): Promise<JsonObject> {
  const all = await catalogRows();
  const query = (input.query ?? "").normalize("NFKC").trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const rows = all.filter((row) => (!input.platform || row.platform_id === input.platform.toLowerCase()) &&
    terms.every((term) => `${row.platform_name} ${row.platform_id} ${row.display_name} ${row.capability}`.toLowerCase().includes(term)));
  const offset = input.offset ?? 0, limit = input.limit ?? 20;
  return { success: true, scope: "all_provider_data_capabilities", total_registered: all.length, matched: rows.length,
    next_offset: offset + limit < rows.length ? offset + limit : null,
    platforms: [...new Map(all.map((row) => [row.platform_id,{ id: row.platform_id,name: row.platform_name }])).values()],
    capabilities: rows.slice(offset,offset+limit).map((row) => capabilityView(row,authorization)),
    instruction: "This covers product, content, profiles, metrics and AI answers. A blocking reason does not mean the provider has no interface; never use the marketplace-only list as the full capability catalog." };
}

export async function readDataCapability(id: string, authorization: DataCapabilityAuthorization): Promise<{ row: DataCapabilityRow; view: JsonObject }> {
  const row = (await catalogRows()).find((entry) => capabilityId(entry.endpoint_id) === id);
  if (!row) throw new DataCapabilityError("数据能力未在当前供应商目录登记。", "DATA_CAPABILITY_NOT_FOUND");
  return { row, view: capabilityView(row,authorization,true) };
}

function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
