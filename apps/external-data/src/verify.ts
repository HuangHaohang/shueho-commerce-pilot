import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";
import { Client } from "pg";

import { database, withScope } from "./database.js";
import { getEndpoint } from "./endpoint-registry.js";
import { LocalModelClient } from "./local-model-client.js";
import { ExternalDataPipeline } from "./pipeline.js";
import { drainIndexOutbox, searchIndexHealth } from "./search-index.js";
import type { JsonObject } from "./types.js";

const sourceEnvironment = parse(readFileSync(resolve(process.cwd(), "../web/.env.migration"), "utf8"));
const sourceUrl = sourceEnvironment.MIGRATION_DATABASE_URL;
if (!sourceUrl) throw new Error("apps/web/.env.migration is missing MIGRATION_DATABASE_URL.");

const source = new Client({ connectionString: sourceUrl, application_name: "external-data-verification-import" });
await source.connect();
const archived = await source.query<{
  id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  root_thread_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  endpoint_id: string;
  request_payload: JsonObject;
  response_payload: JsonObject;
  upstream_request_id: string | null;
  provider_recorded_at: Date | null;
}>(`
  SELECT id, tenant_id, workspace_id, user_id, root_thread_id, thread_id, turn_id,
         endpoint_id, request_payload, response_payload, upstream_request_id, provider_recorded_at
  FROM commerce_external_data_archive
  WHERE endpoint_id='taobao.search_item_list_v1' AND state='succeeded'
    AND response_payload #> '{data,model}' IS NOT NULL
  ORDER BY completed_at DESC
  LIMIT 1
`);
await source.end();
const row = archived.rows[0];
if (!row) throw new Error("No successful legacy Taobao archive is available for verification.");
const params = isRecord(row.request_payload.params) ? row.request_payload.params : {};
const models = new LocalModelClient();
const modelHealth = await models.health();
assert.equal(modelHealth.fake, false, "real Qwen3 models must be active for final verification");
const endpoint = await getEndpoint(row.endpoint_id);

const scope = {
  tenantId: row.tenant_id,
  workspaceId: row.workspace_id,
  userId: row.user_id,
  source: "archive_import" as const,
  sourceCallId: `archive_${row.id.replaceAll("-", "")}_${endpoint.schemaVersion.replace(/[^A-Za-z0-9_]/g, "_")}`,
  rootThreadId: row.root_thread_id,
  threadId: row.thread_id,
  turnId: row.turn_id,
  requestText: "帮我调研一下淘宝上蘑菇勺的价格带在什么区间，卖得好的产品销量量级",
  topN: 50,
};
const pipeline = new ExternalDataPipeline(undefined, models);
const result = await pipeline.ingestArchived(scope, row.endpoint_id, params, row.response_payload, {
  providerRequestId: row.upstream_request_id,
  providerRecordedAt: row.provider_recorded_at?.toISOString() ?? null,
});
assert.equal(result.success, true);
assert.equal(result.raw_archive_id.length, 36);
assert.ok(result.products.length > 0, "no products were promoted to the business layer");
assert.ok(result.products.every((product) => !/手机|电脑|RTX\d+/i.test(String(product.title ?? ""))), "cross-category products reached the business layer");
assert.ok(result.products.every((product) => /^https:\/\/item\.taobao\.com\/item\.htm\?id=\d+$/.test(String(product.canonical_url ?? ""))), "business products are missing traceable source links");

const evidence = await withScope(scope, async (client) => {
  const counts = await client.query<{
    items: string;
    brands: string;
    properties: string;
    property_values: string;
    rejected_brands: string;
    rejected_property_values: string;
    vectors: string;
    business_products: string;
    audit_events: string;
    raw_bytes: number;
    raw_text_bytes: number;
    raw_binary_bytes: number;
    raw_hash_valid: boolean;
    raw_permanent: boolean;
    stored_request_text: string;
    requested_keyword: string | null;
  }>(`
    SELECT
      (SELECT count(*)::text FROM taobao_search_item item JOIN taobao_search_snapshot snapshot ON snapshot.id=item.snapshot_id WHERE snapshot.research_request_id=$1) AS items,
      (SELECT count(*)::text FROM taobao_search_brand brand JOIN taobao_search_snapshot snapshot ON snapshot.id=brand.snapshot_id WHERE snapshot.research_request_id=$1) AS brands,
      (SELECT count(*)::text FROM taobao_search_property property JOIN taobao_search_snapshot snapshot ON snapshot.id=property.snapshot_id WHERE snapshot.research_request_id=$1) AS properties,
      (SELECT count(*)::text FROM taobao_search_property_value value JOIN taobao_search_snapshot snapshot ON snapshot.id=value.snapshot_id WHERE snapshot.research_request_id=$1) AS property_values,
      (SELECT count(*)::text FROM taobao_search_brand brand JOIN taobao_search_snapshot snapshot ON snapshot.id=brand.snapshot_id WHERE snapshot.research_request_id=$1 AND brand.quality_status='rejected') AS rejected_brands,
      (SELECT count(*)::text FROM taobao_search_property_value value JOIN taobao_search_snapshot snapshot ON snapshot.id=value.snapshot_id WHERE snapshot.research_request_id=$1 AND value.quality_status='rejected') AS rejected_property_values,
      (SELECT count(*)::text FROM semantic_document WHERE research_request_id=$1) AS vectors,
      (SELECT count(*)::text FROM business_product_observation WHERE research_request_id=$1) AS business_products,
      (SELECT count(*)::text FROM service_audit_event WHERE research_request_id=$1) AS audit_events,
      (SELECT response_bytes FROM external_api_call_raw WHERE research_request_id=$1 LIMIT 1) AS raw_bytes,
      (SELECT octet_length(response_body_text) FROM external_api_call_raw WHERE research_request_id=$1 LIMIT 1) AS raw_text_bytes,
      (SELECT octet_length(response_body_bytes) FROM external_api_call_raw WHERE research_request_id=$1 LIMIT 1) AS raw_binary_bytes,
      (SELECT response_sha256 = encode(digest(response_body_bytes,'sha256'),'hex')
        FROM external_api_call_raw WHERE research_request_id=$1 LIMIT 1) AS raw_hash_valid,
      (SELECT retention_until IS NULL FROM external_api_call_raw WHERE research_request_id=$1 LIMIT 1) AS raw_permanent,
      (SELECT request_text FROM research_request WHERE id=$1) AS stored_request_text,
      (SELECT requested_params->>'keyword' FROM external_query WHERE research_request_id=$1 LIMIT 1) AS requested_keyword
  `, [result.research_request_id]);
  const anomalies = await client.query<{ brand_id: string | null; length: number; controls: number }>(`
    SELECT brand_id, char_length(brand_name_raw) AS length,
           char_length(brand_name_raw) - char_length(regexp_replace(brand_name_raw, '[[:cntrl:]]', '', 'g')) AS controls
    FROM taobao_search_brand brand
    JOIN taobao_search_snapshot snapshot ON snapshot.id=brand.snapshot_id
    WHERE snapshot.research_request_id=$1 AND brand.quality_status='rejected'
    ORDER BY length DESC
  `, [result.research_request_id]);
  return { counts: counts.rows[0], anomalies: anomalies.rows };
});
assert.ok(evidence.counts);
assert.equal(Number(evidence.counts.items), 10);
assert.equal(Number(evidence.counts.brands), 36);
assert.equal(Number(evidence.counts.properties), 7);
assert.equal(Number(evidence.counts.property_values), 89);
assert.ok(Number(evidence.counts.rejected_brands) >= 2);
assert.ok(Number(evidence.counts.rejected_property_values) >= 9);
assert.ok(Number(evidence.counts.vectors) > 0);
assert.ok(Number(evidence.counts.business_products) > 0);
assert.ok(Number(evidence.counts.audit_events) >= 4);
assert.equal(evidence.counts.raw_bytes, evidence.counts.raw_text_bytes);
assert.equal(evidence.counts.raw_bytes, evidence.counts.raw_binary_bytes);
assert.equal(evidence.counts.raw_hash_valid, true);
assert.equal(evidence.counts.raw_permanent, true);
assert.equal(evidence.counts.stored_request_text, scope.requestText);
assert.equal(evidence.counts.requested_keyword, "蘑菇勺");
assert.ok(evidence.anomalies.some((anomaly) => anomaly.brand_id === "33467" && anomaly.length > 20_000 && anomaly.controls > 3_000));

const unscoped = await database.query<{
  visible_raw_rows: string;
  can_delete_raw: boolean;
}>(`
  SELECT
    (SELECT count(*)::text FROM external_api_call_raw) AS visible_raw_rows,
    has_table_privilege(current_user, 'external_api_call_raw', 'DELETE') AS can_delete_raw
`);
assert.equal(Number(unscoped.rows[0]?.visible_raw_rows), 0, "raw rows are visible without an RLS scope");
assert.equal(unscoped.rows[0]?.can_delete_raw, false, "runtime role can delete raw archive rows");
const crossTenantCount = await withScope({ tenantId: randomUUID(), workspaceId: randomUUID() }, async (client) => {
  const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM external_api_call_raw");
  return Number(count.rows[0]?.count ?? 0);
});
assert.equal(crossTenantCount, 0, "raw rows crossed the tenant/workspace RLS boundary");

await drainIndexOutbox(500);
const elastic = await searchIndexHealth();
assert.ok(Number(elastic.indexedDocuments) > 0);

console.log(JSON.stringify({
  verified: true,
  researchRequestId: result.research_request_id,
  rawArchiveId: result.raw_archive_id,
  queryKey: result.query_key,
  counts: evidence.counts,
  elasticsearch: elastic,
  modelHealth,
}, null, 2));
await database.end();

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
