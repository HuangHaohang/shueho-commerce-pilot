import assert from "node:assert/strict";

import { Ajv } from "ajv";
import { Client } from "pg";

import { config } from "./config.js";
import { database } from "./database.js";
import { validateEndpointParams } from "./endpoint-registry.js";
import { readMarketplaceOptions, readMarketplaceResearchPlatforms } from "./market-options.js";
import { buildProviderTransportRequest } from "./transport-request.js";
import type { JsonObject, ProviderEndpoint } from "./types.js";

const catalog = await database.query<{
  endpoint_id: string; platform_id: string; platform_name: string; display_name: string;
  capability: string; api_path: string; http_method: "GET" | "POST"; schema_version: string;
  request_schema: JsonObject; response_schema: JsonObject; request_codec: JsonObject;
  pagination_strategy: JsonObject; response_family: string; normalizer_version: string;
  catalog_status: ProviderEndpoint["catalogStatus"]; pricing_status: ProviderEndpoint["pricingStatus"];
  permission_status: ProviderEndpoint["permissionStatus"]; enabled: boolean;
}>(`
  SELECT endpoint_id,platform_id,platform_name,display_name,capability,api_path,http_method,
         schema_version,request_schema,response_schema,request_codec,pagination_strategy,
         response_family,normalizer_version,catalog_status,pricing_status,permission_status,enabled
  FROM provider_endpoint WHERE provider='justoneapi' ORDER BY endpoint_id
`);
const endpoints = catalog.rows.map(mapEndpoint);
const enabled = endpoints.filter((endpoint) => endpoint.enabled);
const receipt = await database.query<{ manifest_count: number; callable_count: number; openapi_count: number; pricing_count: number }>(`
  SELECT jsonb_array_length(manifest) AS manifest_count,callable_count,openapi_count,pricing_count
  FROM provider_catalog_import_receipt
  WHERE provider='justoneapi' ORDER BY created_at DESC LIMIT 1
`);
const latestReceipt = receipt.rows[0];
assert.ok(latestReceipt, "no immutable provider catalog receipt is available");
assert.equal(endpoints.length, latestReceipt.manifest_count, "endpoint rows do not match the latest immutable catalog manifest");
assert.equal(enabled.length, latestReceipt.callable_count, "callable catalog count does not match the latest pricing intersection");

const ajv = new Ajv({ strict: false, validateFormats: false });
const failures: Array<{ endpointId: string; error: string }> = [];
const methodCounts = { GET: 0, POST: 0 };
const formPostEndpoints: string[] = [];
for (const endpoint of enabled) {
  try {
    ajv.compile(endpoint.requestSchema);
    const supplied = minimumInput(endpoint);
    const effective = validateEndpointParams(endpoint, supplied);
    const transport = buildProviderTransportRequest(endpoint, effective);
    assert.equal(transport.httpMethod, endpoint.httpMethod);
    assert.match(transport.apiPath, /^\/api\//);
    assert.equal(hasProviderCredential(transport.requestArtifact), false);
    assert.ok(transport.requestBytes > 1 && transport.requestBytes <= 1_048_576);
    methodCounts[endpoint.httpMethod] += 1;
    if (endpoint.httpMethod === "POST" && transport.contentType === "application/x-www-form-urlencoded") {
      formPostEndpoints.push(endpoint.endpointId);
      assert.ok(transport.bodyText !== null);
    }
  } catch (error) {
    failures.push({ endpointId: endpoint.endpointId, error: error instanceof Error ? error.message : String(error) });
  }
}
const workflowCatalog = await database.query<{
  workflow_id: string;
  platform_id: string;
  maximum_provider_calls: number;
  step_count: string;
  callable_step_count: string;
}>(`
  SELECT workflow.workflow_id,workflow.platform_id,workflow.maximum_provider_calls,
         count(step.*)::text AS step_count,
         count(step.*) FILTER (WHERE endpoint.enabled)::text AS callable_step_count
  FROM provider_business_workflow workflow
  JOIN provider_business_workflow_step step ON step.workflow_id=workflow.workflow_id
  JOIN provider_endpoint endpoint ON endpoint.endpoint_id=step.endpoint_id
  WHERE workflow.provider='justoneapi' AND workflow.status='active'
  GROUP BY workflow.workflow_id,workflow.platform_id,workflow.maximum_provider_calls
  ORDER BY workflow.workflow_id
`);
assert.equal(workflowCatalog.rows.length, 8, "expected eight active marketplace workflow contracts");
for (const workflow of workflowCatalog.rows) {
  assert.equal(Number(workflow.step_count), workflow.maximum_provider_calls);
  assert.equal(Number(workflow.callable_step_count), workflow.maximum_provider_calls);
}
assert.equal(
  workflowCatalog.rows.find((workflow) => workflow.workflow_id === "jd.products_by_keyword_v1")?.maximum_provider_calls,
  3,
  "JD workflow must contain search, detail and price calls",
);
const marketOptions = await database.query<{
  endpoint_id: string;
  parameter_name: string;
  market_code: string;
  display_name: string;
  schema_version: string;
}>(`
  SELECT endpoint_id,parameter_name,market_code,display_name,schema_version
  FROM provider_market_option WHERE provider='justoneapi' AND enabled=true
  ORDER BY endpoint_id,parameter_name,market_code
`);
assert.ok(marketOptions.rows.length > 0, "provider market option master data is empty");
const endpointById = new Map(enabled.map((endpoint) => [endpoint.endpointId, endpoint]));
for (const option of marketOptions.rows) {
  const endpoint = endpointById.get(option.endpoint_id);
  assert.ok(endpoint, `market option references disabled endpoint ${option.endpoint_id}`);
  assert.equal(endpoint.schemaVersion, option.schema_version);
  const properties = isRecord(endpoint.requestSchema.properties) ? endpoint.requestSchema.properties : {};
  const schema = isRecord(properties[option.parameter_name]) ? properties[option.parameter_name] as JsonObject : {};
  assert.ok(Array.isArray(schema.enum) && schema.enum.includes(option.market_code));
  assert.ok(option.display_name.length > 0);
}
const marketplacePlatforms = await readMarketplaceResearchPlatforms();
assert.deepEqual(
  marketplacePlatforms.platforms.map((platform) => platform.platform).sort(),
  workflowCatalog.rows.map((workflow) => workflow.platform_id).sort(),
  "the Agent marketplace catalog must exactly match active business workflows",
);
assert.equal(marketplacePlatforms.platforms.some((platform) => platform.platform === "pinduoduo"), false);
assert.equal(marketplacePlatforms.platforms.some((platform) => platform.platform === "douyin_ec"), true);
const unsupportedMarketplace = await readMarketplaceOptions("PINDUODUO");
assert.equal(unsupportedMarketplace.available, false);
assert.equal(unsupportedMarketplace.supportedPlatforms?.length, workflowCatalog.rows.length);
const ambiguousDouyin = await readMarketplaceOptions("DOUYIN");
assert.equal(ambiguousDouyin.available, false);
assert.equal(ambiguousDouyin.suggestedPlatforms?.some((platform) => platform.platform === "douyin_ec"), true);
const douyinEcommerce = await readMarketplaceOptions("DOUYIN_EC");
assert.equal(douyinEcommerce.available, true);
assert.equal(douyinEcommerce.canonicalPlatform, "douyin_ec");
await database.end();
if (failures.length) throw new Error(`Catalog contract verification failed: ${JSON.stringify(failures.slice(0, 30))}`);
assert.ok(methodCounts.GET > 0);
assert.ok(methodCounts.POST > 0);
assert.ok(formPostEndpoints.length > 0);
if (!config.migrationDatabaseUrl) throw new Error("EXTERNAL_DATA_MIGRATION_DATABASE_URL is required for source-blob verification.");
const owner = new Client({ connectionString: config.migrationDatabaseUrl, application_name: "external-data-catalog-verifier" });
await owner.connect();
const sourceBlobs = await owner.query<{ total: string; valid_hashes: string; valid_sizes: string }>(`
  WITH latest AS (
    SELECT id FROM provider_catalog_import_receipt WHERE provider='justoneapi' ORDER BY created_at DESC LIMIT 1
  )
  SELECT count(*)::text AS total,
         count(*) FILTER (WHERE source_sha256=encode(digest(convert_to(body_text,'UTF8'),'sha256'),'hex'))::text AS valid_hashes,
         count(*) FILTER (WHERE source_bytes=octet_length(body_text))::text AS valid_sizes
  FROM provider_catalog_source_blob WHERE receipt_id=(SELECT id FROM latest)
`);
await owner.end();
const blobCounts = sourceBlobs.rows[0];
const expectedBlobs = latestReceipt.openapi_count + 1;
assert.equal(Number(blobCounts?.total ?? 0), expectedBlobs);
assert.equal(Number(blobCounts?.valid_hashes ?? 0), expectedBlobs);
assert.equal(Number(blobCounts?.valid_sizes ?? 0), expectedBlobs);
console.log(JSON.stringify({
  ok: true,
  totalCatalogEndpoints: endpoints.length,
  callableEndpoints: enabled.length,
  openapiEndpoints: latestReceipt.openapi_count,
  pricingEndpoints: latestReceipt.pricing_count,
  methodCounts,
  formPostCount: formPostEndpoints.length,
  businessWorkflows: workflowCatalog.rows.map((workflow) => ({
    id: workflow.workflow_id,
    platform: workflow.platform_id,
    providerCalls: workflow.maximum_provider_calls,
  })),
  marketplaceResearchPlatforms: marketplacePlatforms.platforms.map((platform) => ({
    id: platform.platform,
    label: platform.label,
  })),
  marketOptions: marketOptions.rows.length,
  immutableSourceBlobs: expectedBlobs,
  disabled: {
    deprecated: endpoints.filter((endpoint) => endpoint.catalogStatus === "deprecated").length,
    missingPricing: endpoints.filter((endpoint) => endpoint.pricingStatus === "missing").length,
    unavailable: endpoints.filter((endpoint) => endpoint.permissionStatus === "unavailable").length,
  },
}, null, 2));

function mapEndpoint(row: typeof catalog.rows[number]): ProviderEndpoint {
  return {
    endpointId: row.endpoint_id, platformId: row.platform_id, platformName: row.platform_name,
    displayName: row.display_name, capability: row.capability, apiPath: row.api_path,
    httpMethod: row.http_method, schemaVersion: row.schema_version, requestSchema: row.request_schema,
    responseSchema: row.response_schema, requestCodec: row.request_codec,
    paginationStrategy: row.pagination_strategy, responseFamily: row.response_family,
    normalizerVersion: row.normalizer_version, catalogStatus: row.catalog_status,
    pricingStatus: row.pricing_status, permissionStatus: row.permission_status,
    enabled: row.enabled,
    documentationUrl: null,
    openapiUrl: null,
  };
}

function minimumInput(endpoint: ProviderEndpoint): JsonObject {
  const schema = endpoint.requestSchema;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : []);
  if (endpoint.endpointId === "search.search_v1") {
    required.add("start");
    required.add("end");
  }
  const params: JsonObject = {};
  for (const key of required) params[key] = sampleValue(key, isRecord(properties[key]) ? properties[key] as JsonObject : {});
  return params;
}

function sampleValue(key: string, schema: JsonObject): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.default !== undefined && schema.default !== "") return schema.default;
  const type = Array.isArray(schema.type) ? schema.type.find((value) => value !== "null") : schema.type;
  if (type === "integer" || type === "number") return Math.max(1, typeof schema.minimum === "number" ? schema.minimum : 1);
  if (type === "boolean") return false;
  if (type === "array") return [];
  if (type === "object") return {};
  if (/^(?:start|begin)/i.test(key)) return "2026-08-01";
  if (/^(?:end|finish)/i.test(key)) return "2026-08-27";
  if (/url|link/i.test(key)) return "https://example.com/resource";
  if (/email/i.test(key)) return "catalog@example.com";
  if (/keyword|query|search|name|text|title/i.test(key)) return "通勤双肩包";
  return "1";
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasProviderCredential(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasProviderCredential);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => key.toLowerCase() === "token" || hasProviderCredential(child));
}
