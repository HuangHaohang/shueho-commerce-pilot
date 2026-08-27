import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";
import { Client } from "pg";

import type { LocalModelClient } from "./local-model-client.js";
import {
  materializeMarketplaceStepParams,
  planMarketplaceProductResearch,
} from "./marketplace-research-planner.js";
import {
  beginMarketplaceWorkflowExecution,
  completeMarketplaceWorkflowExecution,
  completeMarketplaceWorkflowStep,
  resolveMarketplaceWorkflowBindings,
  startMarketplaceWorkflowStep,
} from "./marketplace-workflow-execution.js";
import { ExternalDataPipeline } from "./pipeline.js";
import type { JsonObject } from "./types.js";
import { database, withScope } from "./database.js";
import {
  completeRawWarehouseCall,
  persistNormalizedWarehouseData,
  prepareWarehouseCall,
} from "./warehouse.js";

const webEnvironment = parse(readFileSync(resolve(process.cwd(), "../web/.env.migration"), "utf8"));
if (!webEnvironment.MIGRATION_DATABASE_URL) throw new Error("Missing web migration database URL.");
const source = new Client({ connectionString: webEnvironment.MIGRATION_DATABASE_URL });
await source.connect();
const archived = await source.query<{ endpoint_id: string; request_payload: JsonObject; response_payload: JsonObject }>(`
  SELECT endpoint_id, request_payload, response_payload
  FROM commerce_external_data_archive
  WHERE endpoint_id='taobao.search_item_list_v1' AND state='succeeded'
    AND response_payload #> '{data,model}' IS NOT NULL
  ORDER BY completed_at DESC LIMIT 1
`);
await source.end();
const archive = archived.rows[0];
if (!archive) throw new Error("No Taobao archive fixture is available.");

const tenantId = randomUUID();
const workspaceId = randomUUID();
const fakeModels = {
  health: async () => ({ ok: true }),
  embed: async (texts: string[]) => texts.map((text) => fakeEmbedding(text)),
  rerank: async (_query: string, documents: string[]) => documents.map((document) =>
    /手机|电脑|RTX\d+/i.test(document) ? 0.01 : 0.92),
} as unknown as LocalModelClient;
const scope = {
  tenantId,
  workspaceId,
  userId: "sql-verification-user",
  source: "archive_import" as const,
  sourceCallId: `sql_verify_${randomUUID().replaceAll("-", "")}`,
  requestText: "帮我调研一下淘宝上蘑菇勺的价格带在什么区间，卖得好的产品销量量级",
  topN: 50,
};

try {
  const pipeline = new ExternalDataPipeline(undefined, fakeModels);
  const result = await pipeline.ingestArchived(
    scope,
    archive.endpoint_id,
    isRecord(archive.request_payload.params) ? archive.request_payload.params : {},
    archive.response_payload,
  );
  const failureIssues = result.success ? [] : await withScope(scope, async (client) => {
    const issues = await client.query<{ reason_code: string; details: JsonObject }>(`
      SELECT reason_code,details FROM data_quality_issue
      WHERE research_request_id=$1 ORDER BY created_at
    `, [result.research_request_id]);
    return issues.rows;
  });
  assert.equal(result.success, true, JSON.stringify({
    researchRequestId: result.research_request_id,
    processingState: result.processing_state,
    code: result.code,
    message: result.message,
    coverage: result.coverage,
    exclusions: result.exclusions,
    failureIssues,
  }));
  const repeated = await pipeline.ingestArchived(
    scope,
    archive.endpoint_id,
    isRecord(archive.request_payload.params) ? archive.request_payload.params : {},
    archive.response_payload,
  );
  assert.equal(repeated.research_request_id, result.research_request_id);
  await assert.rejects(
    () => pipeline.ingestArchived(scope, archive.endpoint_id, { keyword: "手机" }, archive.response_payload),
    /different request identity/,
  );
  const counts = await withScope(scope, async (client) => {
    const rows = await client.query<{
      items: string; brands: string; properties: string; property_values: string;
      rejected_brands: string; rejected_values: string; business_products: string;
      business_brands: string; business_properties: string; product_master: string;
      vectors: string; audit_events: string; completed_index_writes: string; raw_capture_valid: boolean;
    }>(`
      SELECT
        (SELECT count(*)::text FROM taobao_search_item) AS items,
        (SELECT count(*)::text FROM taobao_search_brand) AS brands,
        (SELECT count(*)::text FROM taobao_search_property) AS properties,
        (SELECT count(*)::text FROM taobao_search_property_value) AS property_values,
        (SELECT count(*)::text FROM taobao_search_brand WHERE quality_status='rejected') AS rejected_brands,
        (SELECT count(*)::text FROM taobao_search_property_value WHERE quality_status='rejected') AS rejected_values,
        (SELECT count(*)::text FROM business_product_observation) AS business_products,
        (SELECT count(*)::text FROM business_brand_observation) AS business_brands,
        (SELECT count(*)::text FROM business_property_observation) AS business_properties,
        (SELECT count(*)::text FROM business_product) AS product_master,
        (SELECT count(*)::text FROM semantic_document) AS vectors,
        (SELECT count(*)::text FROM service_audit_event) AS audit_events,
        (SELECT count(*)::text FROM index_outbox WHERE state='completed') AS completed_index_writes,
        (SELECT response_bytes = octet_length(response_body_bytes)
          AND response_sha256 = encode(digest(response_body_bytes,'sha256'),'hex')
          FROM external_api_call_raw LIMIT 1) AS raw_capture_valid
    `);
    return rows.rows[0];
  });
  assert.ok(counts);
  assert.equal(Number(counts.items), 10);
  assert.equal(Number(counts.brands), 36);
  assert.equal(Number(counts.properties), 7);
  assert.equal(Number(counts.property_values), 89);
  assert.ok(Number(counts.rejected_brands) >= 2);
  assert.ok(Number(counts.rejected_values) >= 9);
  assert.ok(Number(counts.business_products) > 0);
  assert.ok(Number(counts.business_brands) > 0);
  assert.ok(Number(counts.business_properties) > 0);
  assert.equal(Number(counts.product_master), Number(counts.business_products));
  assert.ok(Number(counts.vectors) > 0);
  assert.ok(Number(counts.audit_events) >= 4);
  assert.ok(Number(counts.completed_index_writes) >=
    Number(counts.business_products) + Number(counts.business_brands) + Number(counts.business_properties));
  assert.equal(counts.raw_capture_valid, true);
  await verifyResumeWithoutProviderCall(archive, fakeModels);
  await verifyNonJsonRawCapture(archive);
  await verifyGenericCatalogPipeline(fakeModels);
  await verifyGenericPostCatalogPipeline(fakeModels);
  await verifyMarketplaceKeywordWorkflow(fakeModels);
  console.log(JSON.stringify({ ok: true, counts }, null, 2));
} finally {
  await cleanupTenant(tenantId);
  await database.end();
}

async function cleanupTenant(targetTenantId: string): Promise<void> {
  const environment = parse(readFileSync(resolve(process.cwd(), ".env"), "utf8"));
  if (!environment.EXTERNAL_DATA_MIGRATION_DATABASE_URL) throw new Error("Missing external-data migration URL.");
  const client = new Client({ connectionString: environment.EXTERNAL_DATA_MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const table of [
      "service_audit_event", "index_outbox", "research_evidence", "research_metric",
      "research_workflow_business_evidence", "research_workflow_binding_evidence",
      "research_workflow_step_execution", "research_workflow_execution",
      "business_evidence_observation",
      "business_product_observation", "business_brand_observation", "business_property_observation",
      "business_content_observation", "business_product", "semantic_document", "ai_decision_review",
      "ai_enrichment_result", "ai_enrichment_job", "data_quality_issue", "social_search_item",
      "social_search_snapshot", "taobao_search_trace", "taobao_search_property_value",
      "taobao_search_property", "taobao_search_brand", "taobao_search_item", "taobao_search_page",
      "taobao_search_snapshot", "generic_source_record", "generic_source_collection",
      "generic_source_snapshot", "normalization_run", "external_api_call_raw", "external_query",
      "research_request",
    ]) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [targetTenantId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
  const elasticUrl = environment.EXTERNAL_DATA_ELASTICSEARCH_URL;
  const elasticIndex = environment.EXTERNAL_DATA_ELASTICSEARCH_INDEX;
  if (elasticUrl && elasticIndex) {
    const response = await fetch(`${elasticUrl.replace(/\/$/, "")}/${elasticIndex}/_delete_by_query?refresh=true&conflicts=proceed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { term: { tenant_id: targetTenantId } } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Unable to clean verification documents from Elasticsearch: ${response.status}`);
    }
  }
}

async function verifyResumeWithoutProviderCall(
  archive: { endpoint_id: string; request_payload: JsonObject; response_payload: JsonObject },
  models: LocalModelClient,
): Promise<void> {
  const recoveryTenantId = randomUUID();
  const recoveryScope = {
    tenantId: recoveryTenantId,
    workspaceId: randomUUID(),
    userId: "recovery-verification-user",
    source: "archive_import" as const,
    sourceCallId: `resume_verify_${randomUUID().replaceAll("-", "")}`,
    requestText: "帮我调研一下淘宝上蘑菇勺的价格带在什么区间，卖得好的产品销量量级",
    topN: 50,
  };
  const params = isRecord(archive.request_payload.params) ? archive.request_payload.params : {};
  const rawBody = JSON.stringify(archive.response_payload);
  try {
    const prepared = await prepareWarehouseCall(recoveryScope, archive.endpoint_id, params);
    await completeRawWarehouseCall(recoveryScope, prepared, {
      state: "succeeded",
      httpStatus: 200,
      payload: archive.response_payload,
      rawBody,
      rawBytes: Buffer.from(rawBody, "utf8"),
      responseSha256: createHash("sha256").update(rawBody, "utf8").digest("hex"),
      contentType: "application/json; recovery-fixture=true",
      responseBytes: Buffer.byteLength(rawBody, "utf8"),
      providerCode: 0,
      providerMessage: "ok",
      providerRequestId: "recovery-fixture",
      providerRecordedAt: null,
    });
    await persistNormalizedWarehouseData(recoveryScope, prepared, archive.response_payload, null);
    const pipeline = new ExternalDataPipeline(undefined, models);
    const resumed = await pipeline.resumeStored(recoveryScope, archive.endpoint_id, params);
    assert.equal(resumed.success, true);
    assert.ok(resumed.products.length > 0);
  } finally {
    await cleanupTenant(recoveryTenantId);
  }
}

async function verifyNonJsonRawCapture(
  archive: { endpoint_id: string; request_payload: JsonObject },
): Promise<void> {
  const tenantId = randomUUID();
  const scope = {
    tenantId,
    workspaceId: randomUUID(),
    userId: "raw-capture-verification-user",
    source: "archive_import" as const,
    sourceCallId: `raw_capture_${randomUUID().replaceAll("-", "")}`,
    requestText: "验证非 JSON 上游响应完整保存",
    topN: 50,
  };
  const params = isRecord(archive.request_payload.params) ? archive.request_payload.params : {};
  const rawBytes = Buffer.from([0x66, 0x61, 0x69, 0x6c, 0xff]);
  try {
    const prepared = await prepareWarehouseCall(scope, archive.endpoint_id, params);
    await completeRawWarehouseCall(scope, prepared, {
      state: "business_failed",
      httpStatus: 502,
      payload: null,
      rawBody: new TextDecoder().decode(rawBytes),
      rawBytes,
      responseSha256: createHash("sha256").update(rawBytes).digest("hex"),
      contentType: "application/octet-stream",
      responseBytes: rawBytes.byteLength,
      providerCode: null,
      providerMessage: "non-JSON fixture",
      providerRequestId: null,
      providerRecordedAt: null,
    });
    const verified = await withScope(scope, async (client) => {
      const result = await client.query<{ valid: boolean }>(`
        SELECT response_payload IS NULL
          AND response_body_bytes=$2::bytea
          AND response_bytes=octet_length(response_body_bytes)
          AND response_sha256=encode(digest(response_body_bytes,'sha256'),'hex') AS valid
        FROM external_api_call_raw WHERE id=$1
      `, [prepared.rawCallId, rawBytes]);
      return result.rows[0]?.valid ?? false;
    });
    assert.equal(verified, true);
  } finally {
    await cleanupTenant(tenantId);
  }
}

async function verifyGenericCatalogPipeline(models: LocalModelClient): Promise<void> {
  const tenantId = randomUUID();
  const scope = {
    tenantId,
    workspaceId: randomUUID(),
    userId: "generic-catalog-verification-user",
    source: "archive_import" as const,
    sourceCallId: `generic_verify_${randomUUID().replaceAll("-", "")}`,
    requestText: "调研抖音最近7天轻量通勤双肩包内容趋势",
    topN: 50,
  };
  const payload = {
    code: 0,
    message: "",
    data: {
      business_config: { has_more: 0, next_page: { search_id: "search-fixture" } },
      videos: [
        {
          aweme_id: "douyin-video-1",
          title: "轻量通勤双肩包实测",
          description: "重量、容量和电脑夹层体验",
          url: "https://www.douyin.com/video/123456789",
          create_time: 1_787_760_000,
          statistics: { digg_count: 1200, comment_count: 80 },
          tags: ["通勤", "双肩包"],
        },
        { aweme_id: "douyin-video-2", title: "RTX5090电脑评测" },
      ],
    },
  };
  try {
    const pipeline = new ExternalDataPipeline(undefined, models);
    const result = await pipeline.ingestArchived(scope, "douyin.search_video_v4", {
      keyword: "轻量通勤双肩包",
      publishTime: "_7",
    }, payload);
    assert.equal(result.success, true);
    assert.ok(result.evidence.length > 0);
    assert.ok(result.evidence.every((item) => !/RTX5090/i.test(String(item.title ?? ""))));
    const counts = await withScope(scope, async (client) => {
      const response = await client.query<{
        collections: string; records: string; evidence: string; vectors: string;
        request_query_valid: boolean; request_body_absent: boolean;
      }>(`
        SELECT
          (SELECT count(*)::text FROM generic_source_collection) AS collections,
          (SELECT count(*)::text FROM generic_source_record) AS records,
          (SELECT count(*)::text FROM business_evidence_observation) AS evidence,
          (SELECT count(*)::text FROM semantic_document WHERE entity_type='generic_record') AS vectors,
          (SELECT request_query->>'keyword'='轻量通勤双肩包'
             AND request_query->>'page'='1'
             AND NOT request_query ? 'token' FROM external_api_call_raw LIMIT 1) AS request_query_valid,
          (SELECT request_body IS NULL AND request_body_text IS NULL FROM external_api_call_raw LIMIT 1) AS request_body_absent
      `);
      return response.rows[0];
    });
    assert.ok(counts);
    assert.equal(Number(counts.collections), 2);
    assert.equal(Number(counts.records), 5);
    assert.ok(Number(counts.evidence) > 0);
    assert.ok(Number(counts.vectors) > 0);
    assert.equal(counts.request_query_valid, true);
    assert.equal(counts.request_body_absent, true);
  } finally {
    await cleanupTenant(tenantId);
  }
}

async function verifyGenericPostCatalogPipeline(models: LocalModelClient): Promise<void> {
  const tenantId = randomUUID();
  const scope = {
    tenantId,
    workspaceId: randomUUID(),
    userId: "generic-post-verification-user",
    source: "archive_import" as const,
    sourceCallId: `generic_post_${randomUUID().replaceAll("-", "")}`,
    requestText: "检索微信公众号中关于轻量通勤双肩包的文章",
    topN: 50,
  };
  try {
    const pipeline = new ExternalDataPipeline(undefined, models);
    const result = await pipeline.ingestArchived(scope, "weixin.search_article_v2", {
      keyword: "轻量通勤双肩包",
    }, {
      code: 0,
      message: "",
      data: {
        articles: [{
          articleId: "wechat-article-1",
          title: "轻量通勤双肩包选购指南",
          summary: "比较重量、容量和电脑夹层。",
          url: "https://example.com/wechat/article-1",
        }],
      },
    });
    assert.equal(result.success, true);
    assert.ok(result.evidence.length > 0);
    const request = await withScope(scope, async (client) => {
      const response = await client.query<{
        method: string; query: JsonObject; body: JsonObject | null;
        content_type: string | null; body_text: string | null; token_free: boolean;
      }>(`
        SELECT http_method AS method,request_query AS query,request_body AS body,
               request_content_type AS content_type,request_body_text AS body_text,
               NOT request_query ? 'token'
                 AND request_body::text NOT ILIKE '%token%'
                 AND request_body_text NOT ILIKE '%token%' AS token_free
        FROM external_api_call_raw LIMIT 1
      `);
      return response.rows[0];
    });
    assert.ok(request);
    assert.equal(request.method, "POST");
    assert.deepEqual(request.query, {});
    assert.equal(request.body?.keyword, "轻量通勤双肩包");
    assert.equal(request.body?.currentPage, 1);
    assert.equal(request.content_type, "application/x-www-form-urlencoded");
    assert.match(request.body_text ?? "", /keyword=/);
    assert.equal(request.token_free, true);
  } finally {
    await cleanupTenant(tenantId);
  }
}

async function verifyMarketplaceKeywordWorkflow(models: LocalModelClient): Promise<void> {
  const tenantId = randomUUID();
  const rootCallId = `workflow_verify_${randomUUID().replaceAll("-", "")}`;
  const requestText = "帮我通过关键词查询京东轻量通勤双肩包的商品详情和价格";
  const baseScope = {
    tenantId,
    workspaceId: randomUUID(),
    userId: "workflow-verification-user",
    source: "external_mcp" as const,
    sourceCallId: rootCallId,
    requestText,
    topN: 20,
  };
  try {
    const plan = await planMarketplaceProductResearch({
      platform: "JD",
      keyword: "轻量通勤双肩包",
      localizedKeyword: null,
      market: null,
      tmallOnly: false,
      minPriceYuan: null,
      maxPriceYuan: null,
      requestedMetrics: ["price_band", "sales_level"],
      maxResults: 20,
    });
    assert.equal(plan.workflow.workflowId, "jd.products_by_keyword_v1");
    const execution = await beginMarketplaceWorkflowExecution({
      ...baseScope,
      businessIntent: toExternalBusinessIntent(plan.businessIntent),
    }, plan);
    const pipeline = new ExternalDataPipeline(undefined, models);
    let bindings: Record<string, string | number> = {};
    const payloads: Record<string, JsonObject> = {
      discover: {
        code: 0,
        message: "",
        data: { items: [{ itemId: "100012345", title: "轻量通勤双肩包", price: 129, sales: 2800 }] },
      },
      detail: {
        code: 0,
        message: "",
        data: { itemId: "100012345", title: "轻量通勤双肩包", weightGrams: 570, capacityLiters: 18 },
      },
      price: {
        code: 0,
        message: "",
        data: { itemId: "100012345", price: 129, originalPrice: 199 },
      },
    };
    for (const step of plan.steps) {
      const params = materializeMarketplaceStepParams(step, bindings);
      await startMarketplaceWorkflowStep(baseScope, {
        executionId: execution.workflow_execution_id,
        stepId: step.stepId,
        endpointId: step.endpoint.endpointId,
        params,
      });
      const stepScope = {
        ...baseScope,
        sourceCallId: `${rootCallId}_${step.stepOrder}`,
        businessIntent: {
          ...toExternalBusinessIntent(plan.businessIntent),
          workflowPlanKey: plan.planKey,
          workflowStepId: step.stepId,
          workflowStepRole: step.role,
        },
      };
      const result = await pipeline.ingestArchived(
        stepScope,
        step.endpoint.endpointId,
        params,
        payloads[step.stepId]!,
      );
      await completeMarketplaceWorkflowStep(baseScope, {
        executionId: execution.workflow_execution_id,
        stepId: step.stepId,
        endpointId: step.endpoint.endpointId,
        researchRequestId: result.research_request_id,
        providerCompleted: result.provider_completed,
        processingState: result.processing_state,
        success: result.success,
        code: result.code,
        message: result.message,
      });
      if (step.role === "discovery") {
        bindings = (await resolveMarketplaceWorkflowBindings(baseScope, execution.workflow_execution_id)).bindings;
        assert.equal(bindings.item_id, "100012345");
      }
    }
    const completed = await completeMarketplaceWorkflowExecution(baseScope, execution.workflow_execution_id);
    assert.equal(completed.success, true);
    assert.equal(completed.processing_state, "completed");
    assert.equal(completed.research_request_ids.length, 3);
    assert.ok(completed.products.length > 0);
    assert.ok(isRecord(completed.metrics.discovery));
    assert.ok(isRecord(completed.metrics.discovery.price_band));
    assert.ok(completed.evidence.some((row) => row.quality_basis === "deterministic_structured_metric"));
    const evidence = await withScope(baseScope, async (client) => client.query<{
      bindings: string;
      structured: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM research_workflow_binding_evidence
          WHERE workflow_execution_id=$1) AS bindings,
        (SELECT count(*)::text FROM research_workflow_business_evidence
          WHERE workflow_execution_id=$1) AS structured
    `, [execution.workflow_execution_id]));
    assert.equal(Number(evidence.rows[0]?.bindings), 1);
    assert.ok(Number(evidence.rows[0]?.structured) >= 3);
    const crossTenantVisible = await withScope({
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
    }, async (client) => client.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM research_workflow_execution WHERE id=$1
    `, [execution.workflow_execution_id]));
    assert.equal(Number(crossTenantVisible.rows[0]?.count), 0);
  } finally {
    await cleanupTenant(tenantId);
  }
}

function toExternalBusinessIntent(value: JsonObject) {
  return {
    kind: String(value.kind),
    platform: String(value.platform),
    targetProduct: typeof value.target_product === "string" ? value.target_product : null,
    objective: typeof value.objective === "string" ? value.objective : null,
    requestedMetrics: Array.isArray(value.requested_metrics)
      ? value.requested_metrics.filter((item): item is string => typeof item === "string")
      : [],
    timeRange: null,
    windowEnforcement: null,
    requestedTopN: typeof value.requested_top_n === "number" ? value.requested_top_n : null,
    workflowId: typeof value.workflow_id === "string" ? value.workflow_id : null,
    workflowVersion: typeof value.workflow_version === "string" ? value.workflow_version : null,
  };
}

function fakeEmbedding(text: string): number[] {
  void text;
  return new Array(1024).fill(0).map((_, index) => index === 0 ? 1 : 0);
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
