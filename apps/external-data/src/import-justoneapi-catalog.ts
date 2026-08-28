import "dotenv/config";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";
import { Client } from "pg";

import { syncProviderBusinessWorkflows } from "./business-workflows.js";
import { catalogSha256, discoverJustOneApiCatalog, mergeCatalog, type PricingCatalogRow } from "./catalog-import.js";
import { config } from "./config.js";
import { syncProviderMarketOptions } from "./market-options.js";
import { syncProviderMarketProfiles } from "./market-profiles.js";

if (!config.migrationDatabaseUrl) throw new Error("EXTERNAL_DATA_MIGRATION_DATABASE_URL is required.");
const pricingDatabaseUrl = process.env.JUSTONEAPI_PRICING_DATABASE_URL ?? readWebMigrationUrl();
if (!pricingDatabaseUrl) throw new Error("JUSTONEAPI_PRICING_DATABASE_URL or apps/web/.env.migration MIGRATION_DATABASE_URL is required.");

const pricing = new Client({ connectionString: pricingDatabaseUrl, application_name: "external-data-catalog-pricing-reader" });
await pricing.connect();
let pricingSourceSha256: string;
let pricingRows: PricingCatalogRow[];
try {
  const latest = await pricing.query<{ source_sha256: string }>(`
    SELECT source_sha256 FROM commerce_external_provider_import
    WHERE provider='justoneapi' ORDER BY created_at DESC LIMIT 1
  `);
  pricingSourceSha256 = latest.rows[0]?.source_sha256 ?? "";
  if (!/^[a-f0-9]{64}$/.test(pricingSourceSha256)) throw new Error("No immutable JustOneAPI pricing import is available.");
  const rows = await pricing.query<{
    endpoint_id: string; platform_id: string; platform_name: string; api_path: string;
    currency: string; vendor_unit_cost_micros: string | null; permission_status: "allowed" | "unavailable"; is_active: boolean;
  }>(`
    SELECT endpoint_id,platform_id,platform_name,api_path,currency,
           vendor_unit_cost_micros::text,permission_status,is_active
    FROM commerce_external_provider_endpoint
    WHERE provider='justoneapi' AND is_active=true ORDER BY endpoint_id
  `);
  pricingRows = rows.rows.map((row) => ({
    endpointId: row.endpoint_id,
    platformId: row.platform_id,
    platformName: row.platform_name,
    apiPath: row.api_path,
    currency: row.currency,
    vendorUnitCostMicros: row.vendor_unit_cost_micros === null ? null : Number(row.vendor_unit_cost_micros),
    permissionStatus: row.permission_status,
    isActive: row.is_active,
  }));
} finally {
  await pricing.end();
}

const discovered = await discoverJustOneApiCatalog();
const endpoints = mergeCatalog({ openapis: discovered.openapis, pricingRows });
const manifest = endpoints.map((endpoint) => ({
  endpointId: endpoint.endpointId,
  apiPath: endpoint.apiPath,
  method: endpoint.httpMethod,
  openapiSha256: endpoint.openapiSha256,
  requestSchemaSha256: catalogSha256(endpoint.requestSchema),
  responseSchemaSha256: catalogSha256(endpoint.responseSchema),
  requestCodecSha256: catalogSha256(endpoint.requestCodec),
  paginationStrategySha256: catalogSha256(endpoint.paginationStrategy),
  responseFamily: endpoint.responseFamily,
  normalizerVersion: endpoint.normalizerVersion,
  catalogStatus: endpoint.catalogStatus,
  pricingStatus: endpoint.pricingStatus,
  permissionStatus: endpoint.permissionStatus,
  enabled: endpoint.enabled,
}));
const catalogHash = catalogSha256(manifest);
const warehouse = new Client({ connectionString: config.migrationDatabaseUrl, application_name: "external-data-catalog-importer" });
await warehouse.connect();
try {
  await warehouse.query("BEGIN");
  await warehouse.query("SELECT pg_advisory_xact_lock(hashtext('justoneapi-openapi-catalog-import'))");
  const existing = await warehouse.query<{ id: string }>(`
    SELECT id FROM provider_catalog_import_receipt
    WHERE provider='justoneapi' AND catalog_sha256=$1 AND pricing_source_sha256=$2
  `, [catalogHash, pricingSourceSha256]);
  let receiptId = existing.rows[0]?.id;
  const idempotent = Boolean(receiptId);
  if (!receiptId) {
    const inserted = await warehouse.query<{ id: string }>(`
      INSERT INTO provider_catalog_import_receipt (
        provider,sitemap_url,sitemap_sha256,pricing_source_sha256,catalog_sha256,
        page_count,openapi_count,pricing_count,callable_count,manifest
      ) VALUES ('justoneapi',$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id
    `, [discovered.sitemapUrl, discovered.sitemapSha256, pricingSourceSha256, catalogHash,
      discovered.endpointPages, discovered.openapis.length, pricingRows.length,
      endpoints.filter((endpoint) => endpoint.enabled).length, JSON.stringify(manifest)]);
    receiptId = inserted.rows[0]?.id;
  }
  if (!receiptId) throw new Error("Provider catalog import receipt was not created.");
  await warehouse.query(`
    INSERT INTO provider_endpoint (
      endpoint_id,provider,platform_id,platform_name,display_name,capability,api_path,http_method,
      schema_version,request_schema,response_family,enabled,documentation_group,documentation_url,
      openapi_url,openapi_sha256,operation_id,request_codec,response_schema,pagination_strategy,
      catalog_status,pricing_status,permission_status,currency,vendor_unit_cost_micros,
      normalizer_version,source_catalog_import_id
    )
    SELECT item.endpoint_id,'justoneapi',item.platform_id,item.platform_name,item.display_name,
           item.capability,item.api_path,item.http_method,item.schema_version,item.request_schema,
           item.response_family,item.enabled,item.documentation_group,item.documentation_url,
           item.openapi_url,item.openapi_sha256,item.operation_id,item.request_codec,item.response_schema,
           item.pagination_strategy,item.catalog_status,item.pricing_status,item.permission_status,
           item.currency,item.vendor_unit_cost_micros,item.normalizer_version,$2
    FROM jsonb_to_recordset($1::jsonb) AS item(
      endpoint_id text,platform_id text,platform_name text,display_name text,capability text,
      api_path text,http_method text,schema_version text,request_schema jsonb,response_family text,
      enabled boolean,documentation_group text,documentation_url text,openapi_url text,
      openapi_sha256 text,operation_id text,request_codec jsonb,response_schema jsonb,
      pagination_strategy jsonb,catalog_status text,pricing_status text,permission_status text,
      currency text,vendor_unit_cost_micros bigint,normalizer_version text
    )
    ON CONFLICT (endpoint_id) DO UPDATE SET
      platform_id=EXCLUDED.platform_id,platform_name=EXCLUDED.platform_name,
      display_name=EXCLUDED.display_name,capability=EXCLUDED.capability,api_path=EXCLUDED.api_path,
      http_method=EXCLUDED.http_method,schema_version=EXCLUDED.schema_version,
      request_schema=EXCLUDED.request_schema,response_family=EXCLUDED.response_family,
      enabled=EXCLUDED.enabled,documentation_group=EXCLUDED.documentation_group,
      documentation_url=EXCLUDED.documentation_url,openapi_url=EXCLUDED.openapi_url,
      openapi_sha256=EXCLUDED.openapi_sha256,operation_id=EXCLUDED.operation_id,
      request_codec=EXCLUDED.request_codec,response_schema=EXCLUDED.response_schema,
      pagination_strategy=EXCLUDED.pagination_strategy,catalog_status=EXCLUDED.catalog_status,
      pricing_status=EXCLUDED.pricing_status,permission_status=EXCLUDED.permission_status,
      currency=EXCLUDED.currency,vendor_unit_cost_micros=EXCLUDED.vendor_unit_cost_micros,
      normalizer_version=EXCLUDED.normalizer_version,source_catalog_import_id=EXCLUDED.source_catalog_import_id,
      updated_at=CURRENT_TIMESTAMP
  `, [JSON.stringify(endpoints.map(toDatabaseRow)), receiptId]);
  const endpointByOpenApiUrl = new Map(endpoints.filter((endpoint) => endpoint.openapiUrl)
    .map((endpoint) => [endpoint.openapiUrl as string, endpoint.endpointId]));
  const sourceBlobs = [
    {
      source_kind: "sitemap",
      endpoint_id: null,
      source_url: discovered.sitemapUrl,
      content_type: "application/xml",
      source_sha256: discovered.sitemapSha256,
      source_bytes: Buffer.byteLength(discovered.sitemapText, "utf8"),
      body_text: discovered.sitemapText,
    },
    ...discovered.openapis.map((openapi) => ({
      source_kind: "openapi",
      endpoint_id: endpointByOpenApiUrl.get(openapi.openapiUrl) ?? null,
      source_url: openapi.openapiUrl,
      content_type: "application/json",
      source_sha256: openapi.openapiSha256,
      source_bytes: Buffer.byteLength(openapi.rawDocument, "utf8"),
      body_text: openapi.rawDocument,
    })),
  ];
  if (sourceBlobs.some((blob) => blob.source_kind === "openapi" && blob.endpoint_id === null)) {
    throw new Error("An OpenAPI source blob could not be linked to its imported endpoint.");
  }
  await warehouse.query(`
    INSERT INTO provider_catalog_source_blob (
      receipt_id,provider,source_kind,endpoint_id,source_url,content_type,
      source_sha256,source_bytes,body_text
    )
    SELECT $2,'justoneapi',item.source_kind,item.endpoint_id,item.source_url,item.content_type,
           item.source_sha256,item.source_bytes,item.body_text
    FROM jsonb_to_recordset($1::jsonb) AS item(
      source_kind text,endpoint_id text,source_url text,content_type text,
      source_sha256 text,source_bytes integer,body_text text
    )
    ON CONFLICT (receipt_id,source_url) DO NOTHING
  `, [JSON.stringify(sourceBlobs), receiptId]);
  await warehouse.query(`
    UPDATE provider_endpoint SET enabled=false,catalog_status='removed',updated_at=CURRENT_TIMESTAMP
    WHERE provider='justoneapi' AND source_catalog_import_id IS DISTINCT FROM $1
  `, [receiptId]);
  const marketCatalog = await syncProviderMarketOptions(warehouse, receiptId, endpoints);
  const workflowCatalog = await syncProviderBusinessWorkflows(warehouse, receiptId, endpoints);
  const marketProfiles = await syncProviderMarketProfiles(warehouse, receiptId);
  const readback = await warehouse.query<{ total: string; enabled: string; deprecated: string; missing_pricing: string; missing_openapi: string }>(`
    SELECT count(*)::text AS total,count(*) FILTER (WHERE enabled)::text AS enabled,
           count(*) FILTER (WHERE catalog_status='deprecated')::text AS deprecated,
           count(*) FILTER (WHERE pricing_status='missing')::text AS missing_pricing,
           count(*) FILTER (WHERE catalog_status='missing_openapi')::text AS missing_openapi
    FROM provider_endpoint WHERE provider='justoneapi' AND source_catalog_import_id=$1
  `, [receiptId]);
  await warehouse.query("COMMIT");
  console.log(JSON.stringify({
    ok: true,idempotent,receiptId,catalogSha256: catalogHash,pricingSourceSha256,
    sitemapPages: discovered.endpointPages,openapiCount: discovered.openapis.length,
    pricingCount: pricingRows.length,workflowCount: workflowCatalog.workflowCount,
    workflowStepCount: workflowCatalog.stepCount,workflowDefinitionSha256: workflowCatalog.definitionSha256,
    marketOptionCount: marketCatalog.optionCount,marketPlatformCount: marketCatalog.platformCount,
    marketProfileReceiptId: marketProfiles.receiptId,marketProfileCount: marketProfiles.profileCount,
    linkedMarketOptionCount: marketProfiles.linkedOptionCount,missingMarketProfiles: marketProfiles.missingOptions,
    ...readback.rows[0],
  }, null, 2));
} catch (error) {
  await warehouse.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await warehouse.end();
}

function toDatabaseRow(endpoint: ReturnType<typeof mergeCatalog>[number]): Record<string, unknown> {
  return {
    endpoint_id: endpoint.endpointId,platform_id: endpoint.platformId,platform_name: endpoint.platformName,
    display_name: endpoint.displayName,capability: endpoint.capability,api_path: endpoint.apiPath,
    http_method: endpoint.httpMethod,schema_version: endpoint.schemaVersion,request_schema: endpoint.requestSchema,
    response_family: endpoint.responseFamily,enabled: endpoint.enabled,documentation_group: endpoint.documentationGroup,
    documentation_url: endpoint.documentationUrl,openapi_url: endpoint.openapiUrl,openapi_sha256: endpoint.openapiSha256,
    operation_id: endpoint.operationId,request_codec: endpoint.requestCodec,response_schema: endpoint.responseSchema,
    pagination_strategy: endpoint.paginationStrategy,catalog_status: endpoint.catalogStatus,
    pricing_status: endpoint.pricingStatus,permission_status: endpoint.permissionStatus,currency: endpoint.currency,
    vendor_unit_cost_micros: endpoint.vendorUnitCostMicros,normalizer_version: endpoint.normalizerVersion,
  };
}

function readWebMigrationUrl(): string | null {
  try {
    const values = parse(readFileSync(resolve(process.cwd(), "../web/.env.migration"), "utf8"));
    return values.MIGRATION_DATABASE_URL ?? null;
  } catch {
    return null;
  }
}
