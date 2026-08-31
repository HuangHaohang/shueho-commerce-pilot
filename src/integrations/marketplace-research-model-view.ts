type JsonObject = Record<string, unknown>;

const FORBIDDEN_MODEL_KEYS = new Set([
  "author",
  "bindings",
  "business_input",
  "business_intent",
  "business_tool",
  "call_id",
  "dynamic_parameter_bindings",
  "endpoint_id",
  "first_party_subject",
  "market_profile_id",
  "market_profile_revision",
  "market_profile_sha256",
  "normalized_input",
  "output_bindings",
  "parameter_template",
  "plan_key",
  "profile_id",
  "profile_revision",
  "provider_cost_micros",
  "query_key",
  "raw_archive_id",
  "raw_call_id",
  "raw_data",
  "raw_payload",
  "research_plan_key",
  "request_params",
  "requested_input",
  "response_payload",
  "source_call_id",
  "source_json_pointer",
  "source_raw_call_id",
  "source_record_id",
  "step_id",
  "step_instance_id",
  "step_instance_key",
  "step_templates",
  "steps",
  "target_id",
  "target_ordinal",
  "vendor_cost_micros",
  "workflow",
  "workflow_definition_sha256",
  "workflow_execution_id",
  "workflow_id",
  "workflow_step_id",
  "workflow_step_instance_id",
  "workflow_target_id",
  "workflow_target_ordinal",
  "workflow_version",
]);

/**
 * Produces the bounded business-evidence projection that may be returned to a
 * Codex Harness tool call. Provider routing, raw-warehouse lineage and public
 * profile identities stay in the application control plane. The useful
 * evidence receipt (research id, evidence id, role/kind, URL, metrics,
 * timestamps, quality, confidence, coverage and limitations) is preserved.
 */
export function sanitizeMarketplaceResearchForModel(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeObject(payload);
}

function sanitizeObject(value: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenKey(key)) continue;
    result[key] = sanitizeValue(child);
  }
  return result;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (isRecord(value)) return sanitizeObject(value);
  return value;
}

function isForbiddenKey(value: string): boolean {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return FORBIDDEN_MODEL_KEYS.has(normalized) ||
    normalized.endsWith("_endpoint_id") ||
    normalized.endsWith("_endpoint_ids") ||
    normalized.endsWith("_profile_id") ||
    normalized.endsWith("_profile_revision") ||
    normalized.endsWith("_profile_sha256") ||
    /(?:^|_)(?:token|password|secret|authorization|cookie)(?:_|$)/.test(normalized);
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
