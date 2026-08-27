import type { PoolClient } from "pg";

import { recordServiceAudit } from "./audit.js";
import { applyResearchIntentQuality } from "./intent-quality.js";
import { buildQueryIdentity, canonicalJson, sha256Json, utf8JsonBytes } from "./canonical.js";
import { queryOne, vectorLiteral, withScope } from "./database.js";
import { getEndpoint, validateEndpointParams } from "./endpoint-registry.js";
import {
  shouldEnrichGenericRecord,
  type NormalizedGenericPayload,
} from "./generic-normalizer.js";
import { buildProviderTransportRequest } from "./transport-request.js";
import {
  type NormalizedSocialSearch,
  type NormalizedTaobaoSearch,
} from "./normalizers.js";
import { normalizeWithRegistry } from "./normalizer-registry.js";
import type {
  CompactResearchResult,
  EnrichmentCandidate,
  EnrichmentDecision,
  ExternalDataScope,
  JsonObject,
  ProviderCallResult,
  ProviderEndpoint,
  ProviderTransportRequest,
  QueryIdentity,
} from "./types.js";

export type PreparedWarehouseCall = {
  reused: boolean;
  researchRequestId: string;
  externalQueryId: string;
  rawCallId: string;
  endpoint: ProviderEndpoint;
  identity: QueryIdentity;
  observedAt: string;
  effectiveParams: JsonObject;
  transportRequest: ProviderTransportRequest;
};

export type PersistedNormalization = {
  candidates: EnrichmentCandidate[];
  observedAt: string;
  rawCallId: string;
  queryKey: string;
};

export type WarehouseProcessingState = {
  requestStatus: string;
  rawState: string;
  responsePayload: JsonObject | null;
  providerRecordedAt: string | null;
  failureStage: "normalization" | "enrichment" | null;
};

export async function prepareWarehouseCall(
  scope: ExternalDataScope,
  endpointId: string,
  params: JsonObject,
): Promise<PreparedWarehouseCall> {
  const endpoint = await getEndpoint(endpointId);
  const effectiveParams = validateEndpointParams(endpoint, params);
  const transportRequest = buildProviderTransportRequest(endpoint, effectiveParams);
  const topN = clampInteger(scope.topN ?? 50, 1, 500);
  const identity = buildQueryIdentity({
    endpointId,
    schemaVersion: endpoint.schemaVersion,
    platform: endpoint.platformId,
    params: effectiveParams,
    requestText: scope.requestText,
    topN,
    paginationKeys: stringArray(endpoint.paginationStrategy.requestKeys),
    businessIntent: scope.businessIntent,
  });
  return withScope(scope, async (client) => {
    const inserted = await client.query<{
      id: string;
      status: string;
      user_id: string;
      request_text: string;
      intent_key: string;
      root_thread_id: string | null;
      thread_id: string | null;
      turn_id: string | null;
    }>(`
      INSERT INTO research_request (
        tenant_id, workspace_id, user_id, source, source_call_id,
        root_thread_id, thread_id, turn_id, request_text, structured_intent,
        intent_key, top_n, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,'created')
      ON CONFLICT (tenant_id, source, source_call_id) DO NOTHING
      RETURNING id, status, user_id, request_text, intent_key, root_thread_id, thread_id, turn_id
    `, [
      scope.tenantId,
      scope.workspaceId,
      scope.userId,
      scope.source,
      scope.sourceCallId,
      scope.rootThreadId ?? null,
      scope.threadId ?? null,
      scope.turnId ?? null,
      scope.requestText,
      JSON.stringify(identity.intent),
      identity.intentKey,
      topN,
    ]);
    const request = inserted.rows[0] ?? await queryOne<{
      id: string;
      status: string;
      user_id: string;
      request_text: string;
      intent_key: string;
      root_thread_id: string | null;
      thread_id: string | null;
      turn_id: string | null;
    }>(client, `
      SELECT id, status, user_id, request_text, intent_key, root_thread_id, thread_id, turn_id
      FROM research_request
      WHERE tenant_id=$1 AND source=$2 AND source_call_id=$3
    `, [scope.tenantId, scope.source, scope.sourceCallId]);
    if (!inserted.rows[0]) {
      const existing = await queryOne<{
        external_query_id: string;
        raw_call_id: string;
        endpoint_id: string;
        query_key: string;
        page_key: string;
      }>(client, `
        SELECT query_row.id AS external_query_id, raw.id AS raw_call_id,
               query_row.endpoint_id, query_row.query_key, query_row.page_key
        FROM external_query query_row
        JOIN external_api_call_raw raw ON raw.external_query_id = query_row.id
        WHERE query_row.research_request_id=$1
        LIMIT 1
      `, [request.id]);
      if (
        request.user_id !== scope.userId ||
        request.request_text !== scope.requestText ||
        request.intent_key !== identity.intentKey ||
        request.root_thread_id !== (scope.rootThreadId ?? null) ||
        request.thread_id !== (scope.threadId ?? null) ||
        request.turn_id !== (scope.turnId ?? null) ||
        existing.endpoint_id !== endpoint.endpointId ||
        existing.query_key !== identity.queryKey ||
        existing.page_key !== identity.pageKey
      ) {
        throw new Error("External-data source_call_id is already bound to a different request identity.");
      }
      return {
        reused: true,
        researchRequestId: request.id,
        externalQueryId: existing.external_query_id,
        rawCallId: existing.raw_call_id,
        endpoint,
        identity,
        observedAt: new Date().toISOString(),
        effectiveParams,
        transportRequest,
      };
    }
    const query = await queryOne<{ id: string }>(client, `
      INSERT INTO external_query (
        tenant_id, workspace_id, research_request_id, endpoint_id, schema_version,
        query_key, page_key, requested_params, canonical_query_params, pagination_params
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)
      RETURNING id
    `, [
      scope.tenantId,
      scope.workspaceId,
      request.id,
      endpoint.endpointId,
      endpoint.schemaVersion,
      identity.queryKey,
      identity.pageKey,
      JSON.stringify(params),
      JSON.stringify(identity.canonicalQueryParams),
      JSON.stringify(identity.paginationParams),
    ]);
    const raw = await queryOne<{ id: string }>(client, `
      INSERT INTO external_api_call_raw (
        tenant_id, workspace_id, user_id, research_request_id, external_query_id,
        endpoint_id, api_path, http_method, state, request_params, request_sha256,
        request_bytes, request_query, request_body, request_content_type,
        request_body_text, retention_until, dispatched_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,'dispatched',$9::jsonb,$10,$11,$12::jsonb,
        $13::jsonb,$14,$15,NULL,CURRENT_TIMESTAMP
      )
      RETURNING id
    `, [
      scope.tenantId,
      scope.workspaceId,
      scope.userId,
      request.id,
      query.id,
      endpoint.endpointId,
      endpoint.apiPath,
      endpoint.httpMethod,
      JSON.stringify(effectiveParams),
      transportRequest.requestSha256,
      transportRequest.requestBytes,
      JSON.stringify(transportRequest.query),
      transportRequest.body === null ? null : JSON.stringify(transportRequest.body),
      transportRequest.contentType,
      transportRequest.bodyText,
    ]);
    await client.query("UPDATE research_request SET status='collecting' WHERE id=$1", [request.id]);
    await recordServiceAudit(client, scope, {
      researchRequestId: request.id,
      rawCallId: raw.id,
      action: "research.collection.prepare",
      outcome: "allowed",
      metadata: { endpointId: endpoint.endpointId, queryKey: identity.queryKey, source: scope.source },
    });
    return {
      reused: false,
      researchRequestId: request.id,
      externalQueryId: query.id,
      rawCallId: raw.id,
      endpoint,
      identity,
      observedAt: new Date().toISOString(),
      effectiveParams,
      transportRequest,
    };
  });
}

export async function readWarehouseProcessingState(
  scope: Pick<ExternalDataScope, "tenantId" | "workspaceId">,
  researchRequestId: string,
): Promise<WarehouseProcessingState> {
  return withScope(scope, async (client) => {
    const row = await queryOne<{
      request_status: string;
      raw_state: string;
      response_payload: JsonObject | null;
      provider_recorded_at: Date | null;
      failure_reason_code: string | null;
    }>(client, `
      SELECT request.status AS request_status, raw.state AS raw_state,
             raw.response_payload, raw.provider_recorded_at,
             failure.reason_code AS failure_reason_code
      FROM research_request request
      JOIN external_api_call_raw raw ON raw.research_request_id=request.id
      LEFT JOIN LATERAL (
        SELECT reason_code FROM data_quality_issue
        WHERE research_request_id=request.id AND entity_type='research_request'
          AND reason_code IN ('NORMALIZATION_FAILED','AI_ENRICHMENT_FAILED')
        ORDER BY created_at DESC LIMIT 1
      ) failure ON true
      WHERE request.id=$1 LIMIT 1
    `, [researchRequestId]);
    return {
      requestStatus: row.request_status,
      rawState: row.raw_state,
      responsePayload: row.response_payload,
      providerRecordedAt: row.provider_recorded_at?.toISOString() ?? null,
      failureStage: row.failure_reason_code === "NORMALIZATION_FAILED"
        ? "normalization"
        : row.failure_reason_code === "AI_ENRICHMENT_FAILED"
          ? "enrichment"
          : null,
    };
  });
}

export async function markResearchEnrichingForReprocess(
  scope: Pick<ExternalDataScope, "tenantId" | "workspaceId">,
  researchRequestId: string,
): Promise<void> {
  await withScope(scope, async (client) => {
    const result = await client.query<{ id: string }>(`
      UPDATE research_request request
      SET status='enriching',completed_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE request.id=$1
        AND EXISTS (
          SELECT 1 FROM external_api_call_raw raw
          WHERE raw.research_request_id=request.id AND raw.state='succeeded'
        )
      RETURNING request.id
    `, [researchRequestId]);
    if (!result.rows[0]) throw new Error("Stored enrichment recovery requires one succeeded raw provider call.");
  });
}

export async function loadNormalizedWarehouseCandidates(
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
): Promise<PersistedNormalization> {
  return withScope(scope, async (client) => {
    if (prepared.endpoint.responseFamily === "taobao_search_item_list_v1") {
      const snapshot = await queryOne<{ id: string; observed_at: Date }>(client, `
        SELECT id, observed_at FROM taobao_search_snapshot
        WHERE research_request_id=$1 LIMIT 1
      `, [prepared.researchRequestId]);
      const observedAt = snapshot.observed_at.toISOString();
      const items = await client.query<{
        id: string; ordinal: number; item_id: string | null; item_name_raw: string | null;
        item_sub_name_raw: string | null; shop_id: string | null; shop_name_raw: string | null;
        image_url: string | null; price_yuan: string | null; discounted_price_yuan: string | null;
        sales_display: string | null; sales_lower_bound: string | null; sales_upper_bound: string | null;
        sales_qualifier: "exact" | "gte" | "range" | "unknown" | null; tmall: boolean | null;
        quality_status: "pending" | "valid" | "suspicious" | "rejected"; quality_reasons: string[];
      }>(`SELECT id,ordinal,item_id,item_name_raw,item_sub_name_raw,shop_id,shop_name_raw,
                 image_url,price_yuan,discounted_price_yuan,sales_display,sales_lower_bound,
                 sales_upper_bound,sales_qualifier,tmall,quality_status,quality_reasons
          FROM taobao_search_item WHERE snapshot_id=$1 ORDER BY ordinal`, [snapshot.id]);
      const brands = await client.query<{
        id: string; ordinal: number; brand_id: string | null; brand_name_raw: string | null;
        normalized_name: string | null; item_count: number | null;
        quality_status: "pending" | "valid" | "suspicious" | "rejected"; quality_reasons: string[];
      }>(`SELECT id,ordinal,brand_id,brand_name_raw,normalized_name,item_count,quality_status,quality_reasons
          FROM taobao_search_brand WHERE snapshot_id=$1 ORDER BY ordinal`, [snapshot.id]);
      const properties = await client.query<{
        id: string; value_ordinal: number; property_ordinal: number;
        property_id: string | null; property_name_raw: string | null; normalized_name: string | null;
        value_id: string | null; value_name_raw: string | null; normalized_value: string | null;
        item_count: number | null; quality_status: "pending" | "valid" | "suspicious" | "rejected";
        quality_reasons: string[]; parent_quality_status: "pending" | "valid" | "suspicious" | "rejected";
        parent_quality_reasons: string[];
      }>(`
        SELECT value.id, value.ordinal AS value_ordinal, property.ordinal AS property_ordinal,
               property.property_id, property.property_name_raw, property.normalized_name,
               value.value_id, value.value_name_raw, value.normalized_value, value.item_count,
               value.quality_status, value.quality_reasons,
               property.quality_status AS parent_quality_status,
               property.quality_reasons AS parent_quality_reasons
        FROM taobao_search_property_value value
        JOIN taobao_search_property property ON property.id=value.property_row_id
        WHERE value.snapshot_id=$1 ORDER BY property.ordinal,value.ordinal
      `, [snapshot.id]);
      const keyword = String(prepared.identity.canonicalQueryParams.keyword ?? "");
      const candidates: EnrichmentCandidate[] = [
        ...items.rows.map((item): EnrichmentCandidate => ({
          entityType: "taobao_item",
          entityId: item.id,
          sourceJsonPointer: `/data/model/itemList/${item.ordinal}`,
          content: compactText([
            `商品标题：${item.item_name_raw ?? ""}`,
            item.item_sub_name_raw ? `副标题：${item.item_sub_name_raw}` : "",
            item.shop_name_raw ? `店铺：${item.shop_name_raw}` : "",
            item.discounted_price_yuan !== null ? `价格：${item.discounted_price_yuan}元` : "",
            item.sales_display ? `销量量级：${item.sales_display}` : "",
          ]),
          quality: {
            status: item.quality_status === "pending" ? "suspicious" : item.quality_status,
            reasons: item.quality_reasons,
            normalizedValue: item.item_name_raw?.normalize("NFKC").trim() ?? null,
          },
          supportsPrice: item.discounted_price_yuan !== null,
          supportsSales: item.sales_lower_bound !== null,
          metadata: {
            snapshotId: snapshot.id, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey,
            observedAt, itemId: item.item_id, title: item.item_name_raw, shopId: item.shop_id,
            shopName: item.shop_name_raw, imageUrl: item.image_url,
            priceYuan: nullableNumber(item.discounted_price_yuan), originalPriceYuan: nullableNumber(item.price_yuan),
            salesDisplay: item.sales_display, salesLowerBound: nullableInteger(item.sales_lower_bound),
            salesUpperBound: nullableInteger(item.sales_upper_bound), salesQualifier: item.sales_qualifier,
            tmall: item.tmall,
          },
        })),
        ...brands.rows.map((brand): EnrichmentCandidate => ({
          entityType: "taobao_brand",
          entityId: brand.id,
          sourceJsonPointer: `/data/model/brandList/${brand.ordinal}`,
          content: compactText([`查询关键词：${keyword}`, `品牌候选：${brand.normalized_name ?? brand.brand_name_raw ?? ""}`, `搜索结果覆盖数量：${brand.item_count ?? 0}`]),
          quality: { status: brand.quality_status === "pending" ? "suspicious" : brand.quality_status, reasons: brand.quality_reasons, normalizedValue: brand.normalized_name },
          supportsPrice: false,
          supportsSales: false,
          metadata: { snapshotId: snapshot.id, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey,
            observedAt, brandId: brand.brand_id, brandName: brand.normalized_name, itemCount: brand.item_count },
        })),
        ...properties.rows.map((property): EnrichmentCandidate => {
          const parentRejected = property.parent_quality_status === "rejected";
          const status = parentRejected ? "rejected" : property.quality_status === "pending" ? "suspicious" : property.quality_status;
          return {
            entityType: "taobao_property_value",
            entityId: property.id,
            sourceJsonPointer: `/data/model/propertyList/${property.property_ordinal}/valueList/${property.value_ordinal}`,
            content: compactText([`查询关键词：${keyword}`, `商品属性：${property.normalized_name ?? property.property_name_raw ?? "未知"}`, `属性值：${property.normalized_value ?? property.value_name_raw ?? ""}`, `搜索结果覆盖数量：${property.item_count ?? 0}`]),
            quality: { status, reasons: [...new Set([...property.quality_reasons, ...(parentRejected ? [...property.parent_quality_reasons, "PARENT_PROPERTY_INVALID"] : [])])], normalizedValue: property.normalized_value },
            supportsPrice: false,
            supportsSales: false,
            metadata: { snapshotId: snapshot.id, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey,
              observedAt, propertyId: property.property_id, propertyName: property.normalized_name,
              valueId: property.value_id, propertyValue: property.normalized_value, itemCount: property.item_count },
          };
        }),
      ];
      return { candidates, observedAt, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey };
    }
    if (prepared.endpoint.responseFamily === "social_search_v1") {
      const snapshot = await queryOne<{ id: string; observed_at: Date }>(client, `
      SELECT id, observed_at FROM social_search_snapshot WHERE research_request_id=$1 LIMIT 1
    `, [prepared.researchRequestId]);
    const observedAt = snapshot.observed_at.toISOString();
    const items = await client.query<{
      id: string; ordinal: number; provider_entity_id: string | null; source_name: string | null; source_platform: string | null;
      title_raw: string | null; summary_raw: string | null; author_raw: string | null;
      canonical_url: string | null; published_at: Date | null; metrics: JsonObject;
      quality_status: "pending" | "valid" | "suspicious" | "rejected"; quality_reasons: string[];
    }>(`SELECT id,ordinal,provider_entity_id,source_name,source_platform,title_raw,summary_raw,author_raw,
               canonical_url,published_at,metrics,quality_status,quality_reasons
        FROM social_search_item WHERE snapshot_id=$1 ORDER BY ordinal`, [snapshot.id]);
      return {
      observedAt,
      rawCallId: prepared.rawCallId,
      queryKey: prepared.identity.queryKey,
      candidates: items.rows.map((item): EnrichmentCandidate => ({
        entityType: "social_item",
        entityId: item.id,
        sourceJsonPointer: `/data/items/${item.ordinal}`,
        content: compactText([item.title_raw ?? "", item.summary_raw ?? "", item.source_name ?? ""]),
        quality: { status: item.quality_status === "pending" ? "suspicious" : item.quality_status,
          reasons: item.quality_reasons, normalizedValue: item.title_raw ?? item.summary_raw },
        supportsPrice: false,
        supportsSales: false,
        metadata: { snapshotId: snapshot.id, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey,
          observedAt, sourceName: item.source_name, sourcePlatform: item.source_platform,
          title: item.title_raw, summary: item.summary_raw, author: item.author_raw,
          canonicalUrl: item.canonical_url, publishedAt: item.published_at?.toISOString() ?? null,
          metrics: item.metrics, providerEntityId: item.provider_entity_id },
      })),
      };
    }
    const snapshot = await queryOne<{ id: string; observed_at: Date }>(client, `
      SELECT id,observed_at FROM generic_source_snapshot WHERE research_request_id=$1 LIMIT 1
    `, [prepared.researchRequestId]);
    const observedAt = snapshot.observed_at.toISOString();
    const records = await client.query<{
      id: string; json_pointer: string; record_kind: string; provider_entity_id: string | null;
      title_raw: string | null; summary_raw: string | null; author_raw: string | null;
      canonical_url: string | null; published_at: Date | null; content_text: string | null;
      metrics: JsonObject; quality_status: "pending" | "valid" | "suspicious" | "rejected";
      quality_reasons: string[];
    }>(`
      SELECT id,json_pointer,record_kind,provider_entity_id,title_raw,summary_raw,author_raw,
             canonical_url,published_at,content_text,metrics,quality_status,quality_reasons
      FROM generic_source_record WHERE snapshot_id=$1 AND content_text IS NOT NULL
      ORDER BY json_pointer
    `, [snapshot.id]);
    return {
      observedAt,
      rawCallId: prepared.rawCallId,
      queryKey: prepared.identity.queryKey,
      candidates: records.rows
        .filter((record) => shouldEnrichGenericRecord({
          contentText: record.content_text,
          recordKind: record.record_kind,
          providerEntityId: record.provider_entity_id,
        }, prepared.endpoint.responseFamily))
        .map((record): EnrichmentCandidate => ({
        entityType: "generic_record",
        entityId: record.id,
        sourceJsonPointer: record.json_pointer,
        content: record.content_text ?? "",
        quality: {
          status: record.quality_status === "pending" ? "suspicious" : record.quality_status,
          reasons: record.quality_reasons,
          normalizedValue: record.title_raw ?? record.summary_raw,
        },
        supportsPrice: Object.keys(record.metrics).some((key) => /price|amount|cost/i.test(key)),
        supportsSales: Object.keys(record.metrics).some((key) => /sales|sold|volume/i.test(key)),
        metadata: {
          snapshotId: snapshot.id, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey,
          observedAt, recordKind: record.record_kind, providerEntityId: record.provider_entity_id,
          title: record.title_raw, summary: record.summary_raw, author: record.author_raw,
          canonicalUrl: record.canonical_url, publishedAt: record.published_at?.toISOString() ?? null,
          metrics: record.metrics, sourcePlatform: prepared.endpoint.platformId,
          sourceName: prepared.endpoint.platformName, endpointId: prepared.endpoint.endpointId,
        },
        })),
    };
  });
}

export async function markWarehouseCallUnknown(
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
  reason: string,
): Promise<void> {
  await withScope(scope, async (client) => {
    await client.query(`
      UPDATE external_api_call_raw
      SET state='unknown', provider_message=$2, completed_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND state='dispatched'
    `, [prepared.rawCallId, reason.slice(0, 500)]);
    await client.query("UPDATE research_request SET status='unknown', completed_at=CURRENT_TIMESTAMP WHERE id=$1", [prepared.researchRequestId]);
    await recordServiceAudit(client, scope, {
      researchRequestId: prepared.researchRequestId,
      rawCallId: prepared.rawCallId,
      action: "provider.call.complete",
      outcome: "unknown",
      metadata: { endpointId: prepared.endpoint.endpointId },
    });
  });
}

export async function markWarehouseCallBusinessFailed(
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
  reason: string,
): Promise<void> {
  await withScope(scope, async (client) => {
    await client.query(`
      UPDATE external_api_call_raw
      SET state='business_failed', provider_message=$2, completed_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND state='dispatched'
    `, [prepared.rawCallId, reason.slice(0, 500)]);
    await client.query("UPDATE research_request SET status='failed', completed_at=CURRENT_TIMESTAMP WHERE id=$1", [prepared.researchRequestId]);
    await recordServiceAudit(client, scope, {
      researchRequestId: prepared.researchRequestId,
      rawCallId: prepared.rawCallId,
      action: "provider.call.complete",
      outcome: "failed",
      metadata: { endpointId: prepared.endpoint.endpointId, failureStage: "before_provider_dispatch" },
    });
  });
}

export async function markResearchProcessingFailed(
  scope: ExternalDataScope,
  researchRequestId: string,
  stage: "normalization" | "enrichment",
  error: unknown,
): Promise<void> {
  await withScope(scope, async (client) => {
    await client.query(`
      UPDATE research_request
      SET status='failed', completed_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status IN ('normalizing','enriching')
    `, [researchRequestId]);
    await client.query(`
      INSERT INTO data_quality_issue (
        tenant_id,workspace_id,research_request_id,entity_type,entity_id,
        severity,reason_code,details
      ) VALUES ($1,$2,$3,'research_request',$3,'error',$4,$5::jsonb)
      ON CONFLICT DO NOTHING
    `, [
      scope.tenantId,
      scope.workspaceId,
      researchRequestId,
      stage === "normalization" ? "NORMALIZATION_FAILED" : "AI_ENRICHMENT_FAILED",
      JSON.stringify({ message: safeMessage(error) }),
    ]);
    await recordServiceAudit(client, scope, {
      researchRequestId,
      action: `research.${stage}.complete`,
      outcome: "failed",
      metadata: { errorType: error instanceof Error ? error.name : "UnknownError" },
    });
  });
}

export async function completeRawWarehouseCall(
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
  result: ProviderCallResult,
): Promise<void> {
  await withScope(scope, async (client) => {
    await client.query(`
      UPDATE external_api_call_raw
      SET state=$2, response_payload=$3::jsonb, response_body_text=$4,
          response_body_bytes=$5, response_content_type=$6, response_sha256=$7, response_bytes=$8,
          http_status=$9, provider_code=$10, provider_message=$11,
          provider_request_id=$12, provider_recorded_at=$13,
          completed_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND state='dispatched'
    `, [
      prepared.rawCallId,
      result.state,
      result.payload === null ? null : JSON.stringify(result.payload),
      result.rawBody,
      Buffer.from(result.rawBytes),
      result.contentType,
      result.responseSha256,
      result.responseBytes,
      result.httpStatus,
      result.providerCode,
      result.providerMessage,
      result.providerRequestId,
      result.providerRecordedAt,
    ]);
    await client.query(
      "UPDATE research_request SET status=$2, completed_at=CASE WHEN $2='failed' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=$1",
      [prepared.researchRequestId, result.state === "succeeded" ? "normalizing" : "failed"],
    );
    await recordServiceAudit(client, scope, {
      researchRequestId: prepared.researchRequestId,
      rawCallId: prepared.rawCallId,
      action: "provider.call.complete",
      outcome: result.state === "succeeded" ? "succeeded" : "failed",
      metadata: { endpointId: prepared.endpoint.endpointId, providerCode: result.providerCode },
    });
  });
}

export async function persistNormalizedWarehouseData(
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
  payload: JsonObject,
  providerRecordedAt: string | null,
): Promise<PersistedNormalization> {
  const observedAt = providerRecordedAt ?? new Date().toISOString();
  const run = await withScope(scope, async (client) => {
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO normalization_run (
        tenant_id, workspace_id, raw_call_id, normalizer, normalizer_version, state
      ) VALUES ($1,$2,$3,$4,$5,'running')
      ON CONFLICT (raw_call_id,normalizer,normalizer_version)
      DO UPDATE SET state='running',counts='{}'::jsonb,error_code=NULL,error_message=NULL,
                    started_at=CURRENT_TIMESTAMP,completed_at=NULL
      WHERE normalization_run.state='failed'
      RETURNING id
    `, [scope.tenantId, scope.workspaceId, prepared.rawCallId, prepared.endpoint.responseFamily,
      prepared.endpoint.normalizerVersion]);
    await client.query(`
      UPDATE research_request SET status='normalizing',completed_at=NULL
      WHERE id=$1 AND status IN ('normalizing','failed')
    `, [prepared.researchRequestId]);
    return row;
  });
  try {
    return await withScope(scope, async (client) => {
      const normalized = normalizeWithRegistry(prepared.endpoint, payload);
      const candidates = normalized.kind === "taobao_search"
        ? await persistTaobao(client, scope, prepared, normalized.data, observedAt)
        : normalized.kind === "social_search"
          ? await persistSocial(client, scope, prepared, normalized.data, observedAt)
          : await persistGeneric(client, scope, prepared, normalized.data, observedAt);
      const counts = countCandidates(candidates);
      await client.query(
        "UPDATE normalization_run SET state='completed', counts=$2::jsonb, completed_at=CURRENT_TIMESTAMP WHERE id=$1",
        [run.id, JSON.stringify(counts)],
      );
      await client.query("UPDATE research_request SET status='enriching' WHERE id=$1", [prepared.researchRequestId]);
      await recordServiceAudit(client, scope, {
        researchRequestId: prepared.researchRequestId,
        rawCallId: prepared.rawCallId,
        action: "research.normalization.complete",
        outcome: "succeeded",
        metadata: counts,
      });
      return { candidates, observedAt, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey };
    });
  } catch (error) {
    await withScope(scope, async (client) => {
      await client.query(
        "UPDATE normalization_run SET state='failed', error_code='NORMALIZATION_FAILED', error_message=$2, completed_at=CURRENT_TIMESTAMP WHERE id=$1",
        [run.id, safeMessage(error)],
      );
    }).catch(() => undefined);
    throw error;
  }
}

async function persistTaobao(
  client: PoolClient,
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
  normalized: NormalizedTaobaoSearch,
  observedAt: string,
): Promise<EnrichmentCandidate[]> {
  const params = prepared.identity.canonicalQueryParams;
  const page = prepared.identity.paginationParams;
  const snapshot = await queryOne<{ id: string }>(client, `
    INSERT INTO taobao_search_snapshot (
      tenant_id, workspace_id, research_request_id, external_query_id, raw_call_id,
      query_key, keyword, sort, tmall, top_n, start_price, end_price, requested_page,
      provider_success, response_status, cost_millis, model_extra_map, data_extra_map,
      raw_model, observed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20)
    RETURNING id
  `, [
    scope.tenantId,
    scope.workspaceId,
    prepared.researchRequestId,
    prepared.externalQueryId,
    prepared.rawCallId,
    prepared.identity.queryKey,
    String(params.keyword ?? ""),
    String(params.sort ?? "_sale"),
    params.tmall === true,
    Number(params.top_n ?? 50),
    nullableNumber(params.startPrice),
    nullableNumber(params.endPrice),
    Number(page.page ?? 1),
    normalized.providerSuccess,
    normalized.responseStatus,
    normalized.costMillis,
    JSON.stringify(normalized.modelExtraMap),
    JSON.stringify(normalized.dataExtraMap),
    JSON.stringify(normalized.model),
    observedAt,
  ]);
  const pageData = normalized.page;
  await client.query(`
    INSERT INTO taobao_search_page (
      tenant_id, workspace_id, snapshot_id, page_no, page_size, total_items,
      total_pages, previous_no, next_no, show_begin, show_end, raw_data
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
  `, [
    scope.tenantId,
    scope.workspaceId,
    snapshot.id,
    nullableInteger(pageData.pageNo),
    nullableInteger(pageData.pageSize),
    nullableInteger(pageData.totalItems),
    nullableInteger(pageData.totalPages),
    nullableInteger(pageData.prevNo),
    nullableInteger(pageData.nextNo),
    nullableInteger(pageData.showBegin),
    nullableInteger(pageData.showEnd),
    JSON.stringify(pageData),
  ]);

  const candidates: EnrichmentCandidate[] = [];
  for (const item of normalized.items) {
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO taobao_search_item (
        tenant_id,workspace_id,snapshot_id,ordinal,item_id,product_id,spu_id,shop_id,
        item_name_raw,item_sub_name_raw,shop_name_raw,item_type,tmall,item_location,
        seller_location,image_url,image_urls,price_fen,discounted_price_fen,price_yuan,
        discounted_price_yuan,discount_rate,discount_type,sales_display,sales_lower_bound,
        sales_upper_bound,sales_qualifier,stock,comment_count,item_grade,seller_good_rate,
        seller_level,description_dsr,service_dsr,shipping_dsr,tags,services,extra_map,
        raw_data,raw_sha256,quality_status,quality_reasons
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36::jsonb,$37::jsonb,
        $38::jsonb,$39::jsonb,$40,$41,$42::text[]
      ) RETURNING id
    `, [
      scope.tenantId, scope.workspaceId, snapshot.id, item.ordinal, item.itemId, item.productId,
      item.spuId, item.shopId, item.itemNameRaw, item.itemSubNameRaw, item.shopNameRaw,
      item.itemType, item.tmall, item.itemLocation, item.sellerLocation, item.imageUrl,
      JSON.stringify(item.imageUrls), item.priceFen, item.discountedPriceFen, item.priceYuan,
      item.discountedPriceYuan, item.discountRate, item.discountType, item.salesDisplay,
      item.salesLowerBound, item.salesUpperBound, item.salesQualifier, item.stock,
      item.commentCount, item.itemGrade, item.sellerGoodRate, item.sellerLevel,
      item.descriptionDsr, item.serviceDsr, item.shippingDsr, JSON.stringify(item.tags),
      JSON.stringify(item.services), JSON.stringify(item.extraMap), JSON.stringify(item.rawData),
      item.rawSha256, item.quality.status, item.quality.reasons,
    ]);
    await persistQualityIssues(client, scope, prepared.researchRequestId, "taobao_item", row.id, item.quality);
    candidates.push({
      entityType: "taobao_item",
      entityId: row.id,
      sourceJsonPointer: `/data/model/itemList/${item.ordinal}`,
      content: compactText([
        `商品标题：${item.itemNameRaw ?? ""}`,
        item.itemSubNameRaw ? `副标题：${item.itemSubNameRaw}` : "",
        item.shopNameRaw ? `店铺：${item.shopNameRaw}` : "",
        item.discountedPriceYuan !== null ? `价格：${item.discountedPriceYuan}元` : "",
        item.salesDisplay ? `销量量级：${item.salesDisplay}` : "",
      ]),
      quality: item.quality,
      supportsPrice: item.discountedPriceYuan !== null,
      supportsSales: item.salesLowerBound !== null,
      metadata: {
        snapshotId: snapshot.id,
        rawCallId: prepared.rawCallId,
        queryKey: prepared.identity.queryKey,
        observedAt,
        itemId: item.itemId,
        title: item.quality.normalizedValue,
        shopId: item.shopId,
        shopName: item.shopNameRaw,
        imageUrl: item.imageUrl,
        priceYuan: item.discountedPriceYuan,
        originalPriceYuan: item.priceYuan,
        salesDisplay: item.salesDisplay,
        salesLowerBound: item.salesLowerBound,
        salesUpperBound: item.salesUpperBound,
        salesQualifier: item.salesQualifier,
        tmall: item.tmall,
      },
    });
  }

  for (const brand of normalized.brands) {
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO taobao_search_brand (
        tenant_id,workspace_id,snapshot_id,ordinal,brand_id,brand_name_raw,normalized_name,
        item_count,raw_data,quality_status,quality_reasons
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::text[]) RETURNING id
    `, [scope.tenantId, scope.workspaceId, snapshot.id, brand.ordinal, brand.brandId,
      brand.brandNameRaw, brand.quality.normalizedValue, brand.itemCount, JSON.stringify(brand.rawData),
      brand.quality.status, brand.quality.reasons]);
    await persistQualityIssues(client, scope, prepared.researchRequestId, "taobao_brand", row.id, brand.quality);
    candidates.push({
      entityType: "taobao_brand",
      entityId: row.id,
      sourceJsonPointer: `/data/model/brandList/${brand.ordinal}`,
      content: compactText([
        `查询关键词：${String(params.keyword ?? "")}`,
        `品牌候选：${brand.quality.normalizedValue ?? brand.brandNameRaw ?? ""}`,
        `搜索结果覆盖数量：${brand.itemCount ?? 0}`,
      ]),
      quality: brand.quality,
      supportsPrice: false,
      supportsSales: false,
      metadata: {
        snapshotId: snapshot.id, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey,
        observedAt, brandId: brand.brandId, brandName: brand.quality.normalizedValue, itemCount: brand.itemCount,
      },
    });
  }

  for (const property of normalized.properties) {
    const propertyRow = await queryOne<{ id: string }>(client, `
      INSERT INTO taobao_search_property (
        tenant_id,workspace_id,snapshot_id,ordinal,property_id,property_name_raw,normalized_name,
        flag,raw_data,quality_status,quality_reasons
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::text[]) RETURNING id
    `, [scope.tenantId, scope.workspaceId, snapshot.id, property.ordinal, property.propertyId,
      property.propertyNameRaw, property.quality.normalizedValue, property.flag,
      JSON.stringify(property.rawData), property.quality.status, property.quality.reasons]);
    await persistQualityIssues(client, scope, prepared.researchRequestId, "taobao_property", propertyRow.id, property.quality);
    for (const value of property.values) {
      const combinedQuality = property.quality.status === "rejected"
        ? { status: "rejected" as const, reasons: [...new Set([...property.quality.reasons, ...value.quality.reasons, "PARENT_PROPERTY_INVALID"])], normalizedValue: value.quality.normalizedValue }
        : value.quality;
      const row = await queryOne<{ id: string }>(client, `
        INSERT INTO taobao_search_property_value (
          tenant_id,workspace_id,snapshot_id,property_row_id,ordinal,value_id,value_name_raw,
          normalized_value,item_count,flag,raw_data,quality_status,quality_reasons
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::text[]) RETURNING id
      `, [scope.tenantId, scope.workspaceId, snapshot.id, propertyRow.id, value.ordinal, value.valueId,
        value.valueNameRaw, value.quality.normalizedValue, value.itemCount, value.flag,
        JSON.stringify(value.rawData), value.quality.status, value.quality.reasons]);
      await persistQualityIssues(client, scope, prepared.researchRequestId, "taobao_property_value", row.id, combinedQuality);
      candidates.push({
        entityType: "taobao_property_value",
        entityId: row.id,
        sourceJsonPointer: `/data/model/propertyList/${property.ordinal}/valueList/${value.ordinal}`,
        content: compactText([
          `查询关键词：${String(params.keyword ?? "")}`,
          `商品属性：${property.quality.normalizedValue ?? property.propertyNameRaw ?? "未知"}`,
          `属性值：${value.quality.normalizedValue ?? value.valueNameRaw ?? ""}`,
          `搜索结果覆盖数量：${value.itemCount ?? 0}`,
        ]),
        quality: combinedQuality,
        supportsPrice: false,
        supportsSales: false,
        metadata: {
          snapshotId: snapshot.id, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey,
          observedAt, propertyId: property.propertyId,
          propertyName: property.quality.normalizedValue, valueId: value.valueId,
          propertyValue: value.quality.normalizedValue, itemCount: value.itemCount,
        },
      });
    }
  }

  for (const [ordinal, trace] of normalized.traces.entries()) {
    await client.query(`
      INSERT INTO taobao_search_trace (tenant_id,workspace_id,snapshot_id,ordinal,raw_data)
      VALUES ($1,$2,$3,$4,$5::jsonb)
    `, [scope.tenantId, scope.workspaceId, snapshot.id, ordinal, JSON.stringify(trace)]);
  }
  return candidates;
}

async function persistSocial(
  client: PoolClient,
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
  normalized: NormalizedSocialSearch,
  observedAt: string,
): Promise<EnrichmentCandidate[]> {
  const params = prepared.identity.canonicalQueryParams;
  const page = prepared.identity.paginationParams;
  const snapshot = await queryOne<{ id: string }>(client, `
    INSERT INTO social_search_snapshot (
      tenant_id,workspace_id,research_request_id,external_query_id,raw_call_id,query_key,
      keyword,source_filter,requested_start,requested_end,requested_cursor,next_cursor,
      raw_data,observed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
    RETURNING id
  `, [scope.tenantId, scope.workspaceId, prepared.researchRequestId, prepared.externalQueryId,
    prepared.rawCallId, prepared.identity.queryKey, nullableText(params.keyword), String(params.source ?? "ALL"),
    nullableTime(params.start), nullableTime(params.end), nullableText(page.nextCursor), normalized.nextCursor,
    JSON.stringify(normalized.rawData), observedAt]);
  const candidates: EnrichmentCandidate[] = [];
  for (const item of normalized.items) {
    const quality = applyResearchIntentQuality(item.quality, item.publishedAt, prepared.identity.intent);
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO social_search_item (
        tenant_id,workspace_id,snapshot_id,ordinal,provider_entity_id,source_name,source_platform,title_raw,
        summary_raw,author_raw,canonical_url,published_at,raw_data,raw_sha256,
        metrics,quality_status,quality_reasons
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb,$16,$17::text[])
      RETURNING id
    `, [scope.tenantId, scope.workspaceId, snapshot.id, item.ordinal, item.providerEntityId, item.sourceName,
      item.sourcePlatform, item.titleRaw, item.summaryRaw, item.authorRaw, item.canonicalUrl,
      item.publishedAt, JSON.stringify(item.rawData), item.rawSha256, JSON.stringify(item.metrics), quality.status, quality.reasons]);
    await persistQualityIssues(client, scope, prepared.researchRequestId, "social_item", row.id, quality);
    candidates.push({
      entityType: "social_item",
      entityId: row.id,
      sourceJsonPointer: `/data/items/${item.ordinal}`,
      content: compactText([item.titleRaw ?? "", item.summaryRaw ?? "", item.sourceName ?? ""]),
      quality,
      supportsPrice: false,
      supportsSales: false,
      metadata: {
        snapshotId: snapshot.id, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey,
        observedAt, sourceName: item.sourceName, sourcePlatform: item.sourcePlatform,
        title: item.titleRaw, summary: item.summaryRaw, author: item.authorRaw,
        canonicalUrl: item.canonicalUrl, publishedAt: item.publishedAt, metrics: item.metrics,
        providerEntityId: item.providerEntityId,
      },
    });
  }
  return candidates;
}

async function persistGeneric(
  client: PoolClient,
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
  normalized: NormalizedGenericPayload,
  observedAt: string,
): Promise<EnrichmentCandidate[]> {
  const snapshot = await queryOne<{ id: string }>(client, `
    INSERT INTO generic_source_snapshot (
      tenant_id,workspace_id,research_request_id,external_query_id,raw_call_id,
      endpoint_id,response_family,query_key,data_root,observed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING id
  `, [scope.tenantId, scope.workspaceId, prepared.researchRequestId, prepared.externalQueryId,
    prepared.rawCallId, prepared.endpoint.endpointId, prepared.endpoint.responseFamily,
    prepared.identity.queryKey, JSON.stringify(normalized.dataRoot), observedAt]);
  const collectionIds = new Map<string, string>();
  for (const collection of normalized.collections) {
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO generic_source_collection (
        tenant_id,workspace_id,snapshot_id,json_pointer,collection_key,item_count,raw_data,raw_sha256
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id
    `, [scope.tenantId, scope.workspaceId, snapshot.id, collection.jsonPointer,
      collection.collectionKey, collection.itemCount, JSON.stringify(collection.rawData), collection.rawSha256]);
    collectionIds.set(collection.jsonPointer, row.id);
  }
  const candidates: EnrichmentCandidate[] = [];
  for (const record of normalized.records) {
    const quality = applyResearchIntentQuality(record.quality, record.publishedAt, prepared.identity.intent);
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO generic_source_record (
        tenant_id,workspace_id,snapshot_id,collection_id,parent_json_pointer,json_pointer,
        ordinal,record_kind,provider_entity_id,title_raw,summary_raw,author_raw,canonical_url,
        published_at,content_text,metrics,raw_data,raw_sha256,quality_status,quality_reasons
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20::text[]
      ) RETURNING id
    `, [scope.tenantId, scope.workspaceId, snapshot.id,
      record.collectionJsonPointer ? collectionIds.get(record.collectionJsonPointer) ?? null : null,
      record.parentJsonPointer, record.jsonPointer, record.ordinal, record.recordKind,
      record.providerEntityId, record.titleRaw, record.summaryRaw, record.authorRaw,
      record.canonicalUrl, record.publishedAt, record.contentText, JSON.stringify(record.metrics),
      JSON.stringify(record.rawData), record.rawSha256, quality.status, quality.reasons]);
    await persistQualityIssues(client, scope, prepared.researchRequestId, "generic_record", row.id, quality);
    if (!shouldEnrichGenericRecord(record, prepared.endpoint.responseFamily)) continue;
    candidates.push({
      entityType: "generic_record",
      entityId: row.id,
      sourceJsonPointer: record.jsonPointer,
      content: record.contentText!,
      quality,
      supportsPrice: record.supportsPrice,
      supportsSales: record.supportsSales,
      metadata: {
        snapshotId: snapshot.id, rawCallId: prepared.rawCallId, queryKey: prepared.identity.queryKey,
        observedAt, recordKind: record.recordKind, providerEntityId: record.providerEntityId,
        title: record.titleRaw, summary: record.summaryRaw, author: record.authorRaw,
        canonicalUrl: record.canonicalUrl, publishedAt: record.publishedAt, metrics: record.metrics,
        sourcePlatform: prepared.endpoint.platformId, sourceName: prepared.endpoint.platformName,
        endpointId: prepared.endpoint.endpointId,
      },
    });
  }
  return candidates;
}

export async function createEnrichmentJob(
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
  candidates: EnrichmentCandidate[],
  models: { embeddingModel: string; embeddingDimensions: number; rerankerModel: string },
  enrichmentQueryText: string,
): Promise<string> {
  return withScope(scope, async (client) => {
    const inputHash = sha256Json({
      query: enrichmentQueryText,
      candidates: candidates.map((candidate) => ({
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        content: candidate.content,
        quality: candidate.quality,
      })),
    });
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO ai_enrichment_job (
        tenant_id,workspace_id,research_request_id,query_key,state,embedding_model,
        embedding_dimensions,reranker_model,prompt_version,input_hash,candidate_count,started_at
      ) VALUES ($1,$2,$3,$4,'running',$5,$6,$7,'commerce-relevance-v2',$8,$9,CURRENT_TIMESTAMP)
      ON CONFLICT (research_request_id,input_hash,embedding_model,reranker_model,prompt_version)
      DO UPDATE SET state='running', error_code=NULL, error_message=NULL,
                    started_at=CURRENT_TIMESTAMP, completed_at=NULL
      WHERE ai_enrichment_job.state IN ('running','failed')
      RETURNING id
    `, [scope.tenantId, scope.workspaceId, prepared.researchRequestId, prepared.identity.queryKey,
      models.embeddingModel, models.embeddingDimensions, models.rerankerModel, inputHash, candidates.length]);
    return row.id;
  });
}

export async function failEnrichmentJob(
  scope: ExternalDataScope,
  researchRequestId: string,
  jobId: string,
  error: unknown,
): Promise<void> {
  await withScope(scope, async (client) => {
    await client.query(`
      UPDATE ai_enrichment_job SET state='failed', error_code='AI_ENRICHMENT_FAILED',
        error_message=$2, completed_at=CURRENT_TIMESTAMP WHERE id=$1
    `, [jobId, safeMessage(error)]);
    await client.query("UPDATE research_request SET status='failed', completed_at=CURRENT_TIMESTAMP WHERE id=$1", [researchRequestId]);
    await recordServiceAudit(client, scope, {
      researchRequestId,
      action: "research.enrichment.complete",
      outcome: "failed",
      metadata: { jobId, errorType: error instanceof Error ? error.name : "UnknownError" },
    });
  });
}

export async function persistEnrichmentDecisions(
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
  jobId: string,
  decisions: EnrichmentDecision[],
  embeddings: Map<string, number[]>,
  models: { embeddingModel: string; rerankerModel: string },
): Promise<void> {
  await withScope(scope, async (client) => {
    for (const decision of decisions) {
      const inputHash = sha256Json({ content: decision.content, request: scope.requestText });
      const result = await queryOne<{ id: string }>(client, `
        INSERT INTO ai_enrichment_result (
          tenant_id,workspace_id,job_id,research_request_id,entity_type,entity_id,entity_match,
          category_match,supports_price_analysis,supports_sales_analysis,data_quality,
          lexical_score,embedding_score,rerank_score,relevance_score,confidence,
          normalized_value,reason_codes,decision,model_metadata,input_hash
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::text[],$19,$20::jsonb,$21)
        RETURNING id
      `, [scope.tenantId, scope.workspaceId, jobId, prepared.researchRequestId,
        decision.entityType, decision.entityId, decision.entityMatch,
        decision.entityMatch === "irrelevant" ? false : decision.entityMatch === "unknown" ? null : true,
        decision.supportsPrice, decision.supportsSales, decision.quality.status,
        decision.lexicalScore, decision.embeddingScore, decision.rerankScore,
        decision.relevanceScore, decision.confidence, decision.quality.normalizedValue,
        decision.reasonCodes, decision.decision,
        JSON.stringify({ embeddingModel: models.embeddingModel, rerankerModel: models.rerankerModel, promptVersion: "commerce-relevance-v2" }),
        inputHash]);
      const embedding = embeddings.get(decision.entityId);
      if (embedding) {
        await client.query(`
          INSERT INTO semantic_document (
            tenant_id,workspace_id,research_request_id,entity_type,entity_id,query_key,
            content,content_hash,embedding_model,model_version,dimensions,embedding
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1024,$11::vector)
          ON CONFLICT DO NOTHING
        `, [scope.tenantId, scope.workspaceId, prepared.researchRequestId, decision.entityType,
          decision.entityId, prepared.identity.queryKey, decision.content,
          sha256Json(decision.content), models.embeddingModel, models.embeddingModel, vectorLiteral(embedding)]);
      }
      if (decision.decision === "promote") {
        await promoteDecision(client, scope, prepared, decision, result.id);
      }
    }
    const promoted = decisions.filter((decision) => decision.decision === "promote").length;
    const rejected = decisions.filter((decision) => decision.decision === "reject").length;
    await client.query(`
      UPDATE ai_enrichment_job SET state='completed', accepted_count=$2, rejected_count=$3,
        completed_at=CURRENT_TIMESTAMP WHERE id=$1
    `, [jobId, promoted, rejected]);
    await calculateResearchMetrics(client, scope, prepared);
    await client.query("UPDATE research_request SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id=$1", [prepared.researchRequestId]);
    await recordServiceAudit(client, scope, {
      researchRequestId: prepared.researchRequestId,
      rawCallId: prepared.rawCallId,
      action: "research.enrichment.complete",
      outcome: "succeeded",
      metadata: { jobId, promoted, rejected, held: decisions.length - promoted - rejected },
    });
  });
}

async function promoteDecision(
  client: PoolClient,
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
  decision: EnrichmentDecision,
  enrichmentResultId: string,
): Promise<void> {
  const metadata = decision.metadata;
  let businessId: string;
  if (decision.entityType === "taobao_item") {
    const platformItemId = String(metadata.itemId ?? decision.entityId);
    const canonicalUrl = taobaoItemUrl(metadata.itemId);
    const product = await queryOne<{ id: string }>(client, `
      INSERT INTO business_product (
        tenant_id,workspace_id,platform,platform_item_id,current_title,current_shop_id,
        current_shop_name,current_image_url,canonical_url,first_observed_at,last_observed_at
      ) VALUES ($1,$2,'taobao',$3,$4,$5,$6,$7,$8,$9,$9)
      ON CONFLICT (tenant_id,workspace_id,platform,platform_item_id) DO UPDATE
      SET current_title=EXCLUDED.current_title,
          current_shop_id=EXCLUDED.current_shop_id,
          current_shop_name=EXCLUDED.current_shop_name,
          current_image_url=EXCLUDED.current_image_url,
          canonical_url=EXCLUDED.canonical_url,
          last_observed_at=GREATEST(business_product.last_observed_at,EXCLUDED.last_observed_at)
      RETURNING id
    `, [scope.tenantId, scope.workspaceId, platformItemId, String(metadata.title ?? ""),
      nullableText(metadata.shopId), nullableText(metadata.shopName), nullableText(metadata.imageUrl),
      canonicalUrl, String(metadata.observedAt)]);
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO business_product_observation (
        tenant_id,workspace_id,research_request_id,source_item_id,enrichment_result_id,
        query_key,platform,platform_item_id,title,shop_id,shop_name,image_url,price_yuan,
        original_price_yuan,sales_display,sales_lower_bound,sales_upper_bound,sales_qualifier,
        observed_at,relevance_score,confidence,source_raw_call_id,source_json_pointer,
        source_name,canonical_url,url_derivation,business_product_id
      ) VALUES ($1,$2,$3,$4,$5,$6,'taobao',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      RETURNING id
    `, [scope.tenantId, scope.workspaceId, prepared.researchRequestId, decision.entityId,
      enrichmentResultId, prepared.identity.queryKey, platformItemId,
      String(metadata.title ?? ""), nullableText(metadata.shopId), nullableText(metadata.shopName),
      nullableText(metadata.imageUrl), nullableNumber(metadata.priceYuan), nullableNumber(metadata.originalPriceYuan),
      nullableText(metadata.salesDisplay), nullableInteger(metadata.salesLowerBound), nullableInteger(metadata.salesUpperBound),
      nullableText(metadata.salesQualifier), String(metadata.observedAt), decision.relevanceScore, decision.confidence,
      String(metadata.rawCallId), decision.sourceJsonPointer,
      metadata.tmall === true ? "天猫" : "淘宝",
      canonicalUrl,
      "constructed_from_platform_item_id",
      product.id]);
    businessId = row.id;
    await enqueueIndex(client, scope, "product", row.id, {
      id: row.id, tenant_id: scope.tenantId, workspace_id: scope.workspaceId,
      research_request_id: prepared.researchRequestId, query_key: prepared.identity.queryKey,
      entity_type: "product", title: metadata.title, shop_name: metadata.shopName,
      source_name: metadata.tmall === true ? "天猫" : "淘宝",
      canonical_url: taobaoItemUrl(metadata.itemId),
      price_yuan: metadata.priceYuan, sales_display: metadata.salesDisplay,
      relevance_score: decision.relevanceScore, observed_at: metadata.observedAt,
    });
  } else if (decision.entityType === "taobao_brand") {
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO business_brand_observation (
        tenant_id,workspace_id,research_request_id,source_brand_id,enrichment_result_id,
        query_key,provider_brand_id,brand_name,item_count,relevance_score,observed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
    `, [scope.tenantId, scope.workspaceId, prepared.researchRequestId, decision.entityId,
      enrichmentResultId, prepared.identity.queryKey, nullableText(metadata.brandId),
      String(metadata.brandName), nullableInteger(metadata.itemCount), decision.relevanceScore,
      String(metadata.observedAt)]);
    businessId = row.id;
    await enqueueIndex(client, scope, "brand", row.id, {
      id: row.id, tenant_id: scope.tenantId, workspace_id: scope.workspaceId,
      research_request_id: prepared.researchRequestId, query_key: prepared.identity.queryKey,
      entity_type: "brand", title: metadata.brandName,
      summary: `覆盖商品数：${Number(metadata.itemCount ?? 0)}`,
      source_name: "淘宝品牌筛选", relevance_score: decision.relevanceScore,
      observed_at: metadata.observedAt,
    });
  } else if (decision.entityType === "taobao_property_value") {
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO business_property_observation (
        tenant_id,workspace_id,research_request_id,source_property_value_id,enrichment_result_id,
        query_key,provider_property_id,property_name,provider_value_id,property_value,
        item_count,relevance_score,observed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id
    `, [scope.tenantId, scope.workspaceId, prepared.researchRequestId, decision.entityId,
      enrichmentResultId, prepared.identity.queryKey, nullableText(metadata.propertyId),
      String(metadata.propertyName), nullableText(metadata.valueId), String(metadata.propertyValue),
      nullableInteger(metadata.itemCount), decision.relevanceScore, String(metadata.observedAt)]);
    businessId = row.id;
    await enqueueIndex(client, scope, "property", row.id, {
      id: row.id, tenant_id: scope.tenantId, workspace_id: scope.workspaceId,
      research_request_id: prepared.researchRequestId, query_key: prepared.identity.queryKey,
      entity_type: "property", title: `${String(metadata.propertyName)}：${String(metadata.propertyValue)}`,
      summary: `覆盖商品数：${Number(metadata.itemCount ?? 0)}`,
      source_name: "淘宝属性筛选", relevance_score: decision.relevanceScore,
      observed_at: metadata.observedAt,
    });
  } else if (decision.entityType === "social_item") {
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO business_content_observation (
        tenant_id,workspace_id,research_request_id,source_social_item_id,enrichment_result_id,
        query_key,source_platform,source_name,title,summary,author,canonical_url,published_at,
        metrics,observed_at,relevance_score,confidence,source_raw_call_id,source_json_pointer
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19) RETURNING id
    `, [scope.tenantId, scope.workspaceId, prepared.researchRequestId, decision.entityId,
      enrichmentResultId, prepared.identity.queryKey, nullableText(metadata.sourcePlatform),
      nullableText(metadata.sourceName), nullableText(metadata.title), nullableText(metadata.summary),
      nullableText(metadata.author), nullableText(metadata.canonicalUrl), nullableTime(metadata.publishedAt),
      JSON.stringify(isRecord(metadata.metrics) ? metadata.metrics : {}), String(metadata.observedAt), decision.relevanceScore, decision.confidence,
      String(metadata.rawCallId), decision.sourceJsonPointer]);
    businessId = row.id;
    await enqueueIndex(client, scope, "content", row.id, {
      id: row.id, tenant_id: scope.tenantId, workspace_id: scope.workspaceId,
      research_request_id: prepared.researchRequestId, query_key: prepared.identity.queryKey,
      entity_type: "content", title: metadata.title, summary: metadata.summary,
      source_name: metadata.sourceName, canonical_url: metadata.canonicalUrl,
      relevance_score: decision.relevanceScore, observed_at: metadata.observedAt,
    });
  } else {
    const row = await queryOne<{ id: string }>(client, `
      INSERT INTO business_evidence_observation (
        tenant_id,workspace_id,research_request_id,source_record_id,enrichment_result_id,
        query_key,endpoint_id,source_platform,evidence_kind,provider_entity_id,title,summary,
        author,canonical_url,published_at,metrics,observed_at,relevance_score,confidence,
        source_raw_call_id,source_json_pointer
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21
      ) RETURNING id
    `, [scope.tenantId, scope.workspaceId, prepared.researchRequestId, decision.entityId,
      enrichmentResultId, prepared.identity.queryKey, prepared.endpoint.endpointId,
      String(metadata.sourcePlatform ?? prepared.endpoint.platformId),
      String(metadata.recordKind ?? "record"), nullableText(metadata.providerEntityId),
      nullableText(metadata.title), nullableText(metadata.summary), nullableText(metadata.author),
      nullableText(metadata.canonicalUrl), nullableTime(metadata.publishedAt),
      JSON.stringify(isRecord(metadata.metrics) ? metadata.metrics : {}), String(metadata.observedAt),
      decision.relevanceScore, decision.confidence, String(metadata.rawCallId), decision.sourceJsonPointer]);
    businessId = row.id;
    await enqueueIndex(client, scope, "evidence", row.id, {
      id: row.id, tenant_id: scope.tenantId, workspace_id: scope.workspaceId,
      research_request_id: prepared.researchRequestId, query_key: prepared.identity.queryKey,
      entity_type: "evidence", title: metadata.title, summary: metadata.summary,
      source_name: metadata.sourceName ?? prepared.endpoint.platformName,
      canonical_url: metadata.canonicalUrl, relevance_score: decision.relevanceScore,
      observed_at: metadata.observedAt,
    });
  }
  await client.query(`
    INSERT INTO research_evidence (
      tenant_id,workspace_id,research_request_id,evidence_type,business_record_id,
      source_raw_call_id,source_json_pointer,inclusion_reason,relevance_score,confidence
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [scope.tenantId, scope.workspaceId, prepared.researchRequestId, decision.entityType,
    businessId, String(metadata.rawCallId), decision.sourceJsonPointer,
    decision.reasonCodes.join(","), decision.relevanceScore, decision.confidence]);
}

async function calculateResearchMetrics(
  client: PoolClient,
  scope: ExternalDataScope,
  prepared: PreparedWarehouseCall,
): Promise<void> {
  const products = await client.query<{
    price_yuan: string | null;
    sales_display: string | null;
    sales_lower_bound: string | null;
    sales_upper_bound: string | null;
    sales_qualifier: string | null;
    relevance_score: number;
  }>(`
    SELECT price_yuan, sales_display, sales_lower_bound, sales_upper_bound,
           sales_qualifier, relevance_score
    FROM business_product_observation
    WHERE research_request_id=$1
    ORDER BY relevance_score DESC
  `, [prepared.researchRequestId]);
  const prices = products.rows.map((row) => row.price_yuan === null ? null : Number(row.price_yuan))
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (prices.length) {
    const value = {
      currency: "CNY",
      min: prices[0],
      p25: percentile(prices, 0.25),
      median: percentile(prices, 0.5),
      p75: percentile(prices, 0.75),
      max: prices.at(-1),
    };
    await upsertMetric(client, scope, prepared.researchRequestId, "price_band", value,
      "accepted_products_unweighted_percentiles", prices.length, { acceptedProducts: products.rows.length },
      confidenceForSample(prices.length));
  }
  const salesRows = products.rows.filter((row) => row.sales_display);
  if (salesRows.length) {
    const value = {
      observations: salesRows.map((row) => ({
        display: row.sales_display,
        lowerBound: row.sales_lower_bound === null ? null : Number(row.sales_lower_bound),
        upperBound: row.sales_upper_bound === null ? null : Number(row.sales_upper_bound),
        qualifier: row.sales_qualifier,
      })),
      maximumKnownLowerBound: Math.max(...salesRows.map((row) => Number(row.sales_lower_bound ?? 0))),
      exactValuesAvailable: salesRows.some((row) => row.sales_qualifier === "exact"),
    };
    await upsertMetric(client, scope, prepared.researchRequestId, "sales_level", value,
      "provider_sales_bucket_preserving_open_intervals", salesRows.length,
      { acceptedProducts: products.rows.length }, confidenceForSample(salesRows.length));
  }
  const brands = await client.query<{ brand_name: string; item_count: number | null }>(`
    SELECT brand_name, item_count
    FROM business_brand_observation
    WHERE research_request_id=$1 AND item_count > 0
    ORDER BY item_count DESC, brand_name
  `, [prepared.researchRequestId]);
  if (brands.rows.length) {
    const total = brands.rows.reduce((sum, brand) => sum + Number(brand.item_count ?? 0), 0);
    const distribution = brands.rows.map((brand) => ({
      brand: brand.brand_name,
      itemCount: Number(brand.item_count ?? 0),
      share: total ? Number((Number(brand.item_count ?? 0) / total).toFixed(6)) : 0,
    }));
    await upsertMetric(client, scope, prepared.researchRequestId, "brand_concentration", {
      totalFacetCount: total,
      brandCount: distribution.length,
      top3Share: Number(distribution.slice(0, 3).reduce((sum, brand) => sum + brand.share, 0).toFixed(6)),
      distribution,
    }, "accepted_nonzero_provider_brand_facet_counts", distribution.length,
    { acceptedBrands: distribution.length }, confidenceForSample(distribution.length));
  }
  const properties = await client.query<{ property_name: string; property_value: string; item_count: number | null }>(`
    SELECT property_name, property_value, item_count
    FROM business_property_observation
    WHERE research_request_id=$1 AND item_count > 0
    ORDER BY property_name, item_count DESC, property_value
  `, [prepared.researchRequestId]);
  if (properties.rows.length) {
    const groups = new Map<string, Array<{ value: string; itemCount: number }>>();
    for (const property of properties.rows) {
      const values = groups.get(property.property_name) ?? [];
      values.push({ value: property.property_value, itemCount: Number(property.item_count ?? 0) });
      groups.set(property.property_name, values);
    }
    const distribution = [...groups.entries()].map(([propertyName, values]) => {
      const total = values.reduce((sum, value) => sum + value.itemCount, 0);
      return {
        propertyName,
        totalFacetCount: total,
        values: values.map((value) => ({
          ...value,
          share: total ? Number((value.itemCount / total).toFixed(6)) : 0,
        })),
      };
    });
    await upsertMetric(client, scope, prepared.researchRequestId, "property_distribution", {
      properties: distribution,
    }, "accepted_nonzero_provider_property_facet_counts", properties.rows.length,
    { acceptedPropertyValues: properties.rows.length }, confidenceForSample(properties.rows.length));
  }
}

async function upsertMetric(
  client: PoolClient,
  scope: ExternalDataScope,
  requestId: string,
  metricName: string,
  value: JsonObject,
  method: string,
  sampleCount: number,
  coverage: JsonObject,
  confidence: number,
): Promise<void> {
  await client.query(`
    INSERT INTO research_metric (
      tenant_id,workspace_id,research_request_id,metric_name,metric_value,
      calculation_method,sample_count,coverage,confidence,observed_at
    ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,CURRENT_TIMESTAMP)
    ON CONFLICT (research_request_id,metric_name) DO UPDATE
    SET metric_value=EXCLUDED.metric_value, calculation_method=EXCLUDED.calculation_method,
        sample_count=EXCLUDED.sample_count, coverage=EXCLUDED.coverage,
        confidence=EXCLUDED.confidence, observed_at=EXCLUDED.observed_at
  `, [scope.tenantId, scope.workspaceId, requestId, metricName, JSON.stringify(value),
    method, sampleCount, JSON.stringify(coverage), confidence]);
}

async function enqueueIndex(
  client: PoolClient,
  scope: ExternalDataScope,
  aggregateType: string,
  aggregateId: string,
  payload: JsonObject,
): Promise<void> {
  await client.query(`
    INSERT INTO index_outbox (
      tenant_id,workspace_id,aggregate_type,aggregate_id,operation,payload
    ) VALUES ($1,$2,$3,$4,'index',$5::jsonb)
  `, [scope.tenantId, scope.workspaceId, aggregateType, aggregateId, JSON.stringify(payload)]);
}

export async function loadCompactResearchResult(
  scope: Pick<ExternalDataScope, "tenantId" | "workspaceId">,
  researchRequestId: string,
): Promise<CompactResearchResult> {
  return withScope(scope, async (client) => {
    const request = await queryOne<{
      status: string;
      query_key: string;
      endpoint_id: string;
      raw_call_id: string;
      raw_state: string;
      provider_code: number | null;
      provider_message: string | null;
      observed_at: Date;
      structured_intent: JsonObject;
    }>(client, `
      SELECT request.status, request.structured_intent, query_row.query_key, query_row.endpoint_id,
             raw.id AS raw_call_id, raw.state AS raw_state, raw.provider_code, raw.provider_message,
             COALESCE(raw.provider_recorded_at, raw.completed_at, raw.created_at) AS observed_at
      FROM research_request request
      JOIN external_query query_row ON query_row.research_request_id=request.id
      JOIN external_api_call_raw raw ON raw.external_query_id=query_row.id
      WHERE request.id=$1 LIMIT 1
    `, [researchRequestId]);
    const latestJob = await client.query<{ id: string }>(`
      SELECT id FROM ai_enrichment_job
      WHERE research_request_id=$1 AND state='completed'
      ORDER BY completed_at DESC NULLS LAST,created_at DESC LIMIT 1
    `, [researchRequestId]);
    const latestJobId = latestJob.rows[0]?.id ?? null;
    const specializedProducts = await client.query<JsonObject>(`
      SELECT observation.platform_item_id AS item_id,observation.title,observation.shop_name,
             observation.image_url,observation.source_name,observation.canonical_url,
             observation.url_derivation,observation.price_yuan,
             observation.price_yuan AS price_amount,'CNY'::text AS currency,
             observation.original_price_yuan,
             observation.original_price_yuan AS original_price_amount,
             observation.sales_display,
             observation.sales_lower_bound,observation.sales_upper_bound,
             observation.sales_qualifier,observation.relevance_score,
             observation.confidence,observation.source_json_pointer
      FROM business_product_observation observation
      JOIN ai_enrichment_result enrichment ON enrichment.id=observation.enrichment_result_id
      WHERE observation.research_request_id=$1 AND enrichment.job_id=$2
      ORDER BY observation.relevance_score DESC,observation.price_yuan NULLS LAST LIMIT 30
    `, [researchRequestId, latestJobId]);
    const genericProducts = await client.query<JsonObject>(`
      WITH ranked AS (
        SELECT evidence.source_platform,evidence.provider_entity_id,evidence.title,evidence.author,
               evidence.canonical_url,evidence.metrics,evidence.relevance_score,
               evidence.confidence,evidence.source_json_pointer,
               row_number() OVER (
                 PARTITION BY evidence.source_platform,evidence.provider_entity_id
                 ORDER BY evidence.relevance_score DESC,evidence.id
               ) AS identity_rank
        FROM business_evidence_observation evidence
        JOIN ai_enrichment_result enrichment ON enrichment.id=evidence.enrichment_result_id
        WHERE evidence.research_request_id=$1 AND evidence.evidence_kind='product'
          AND enrichment.job_id=$2
          AND evidence.provider_entity_id IS NOT NULL
      )
      SELECT provider_entity_id AS item_id,title,author AS shop_name,
             NULLIF(metrics->>'image_url','') AS image_url,
             source_platform AS source_name,
             COALESCE(
               canonical_url,
               CASE WHEN source_platform='jd' AND provider_entity_id ~ '^[0-9]+$'
                 THEN 'https://item.jd.com/' || provider_entity_id || '.html'
                 ELSE NULL END
             ) AS canonical_url,
             CASE WHEN canonical_url IS NULL AND source_platform='jd' AND provider_entity_id ~ '^[0-9]+$'
               THEN 'constructed_from_platform_item_id' ELSE NULL END AS url_derivation,
             CASE WHEN jsonb_typeof(metrics->'price_yuan')='number'
               THEN (metrics->>'price_yuan')::numeric ELSE NULL END AS price_yuan,
             CASE
               WHEN jsonb_typeof(metrics->'price_amount')='number'
                 THEN (metrics->>'price_amount')::numeric
               WHEN jsonb_typeof(metrics->'price_yuan')='number'
                 THEN (metrics->>'price_yuan')::numeric
               ELSE NULL
             END AS price_amount,
             CASE
               WHEN metrics->>'currency' ~ '^[A-Z]{3}$' THEN metrics->>'currency'
               WHEN jsonb_typeof(metrics->'price_yuan')='number' THEN 'CNY'
               ELSE NULL
             END AS currency,
             CASE WHEN jsonb_typeof(metrics->'original_price_yuan')='number'
               THEN (metrics->>'original_price_yuan')::numeric ELSE NULL END AS original_price_yuan,
             CASE
               WHEN jsonb_typeof(metrics->'original_price_amount')='number'
                 THEN (metrics->>'original_price_amount')::numeric
               WHEN jsonb_typeof(metrics->'original_price_yuan')='number'
                 THEN (metrics->>'original_price_yuan')::numeric
               ELSE NULL
             END AS original_price_amount,
             metrics->>'sales_display' AS sales_display,
             CASE WHEN jsonb_typeof(metrics->'sales_lower_bound')='number'
               THEN (metrics->>'sales_lower_bound')::bigint ELSE NULL END AS sales_lower_bound,
             CASE WHEN jsonb_typeof(metrics->'sales_upper_bound')='number'
               THEN (metrics->>'sales_upper_bound')::bigint ELSE NULL END AS sales_upper_bound,
             metrics->>'sales_qualifier' AS sales_qualifier,
             metrics->>'review_display' AS review_display,
             CASE WHEN jsonb_typeof(metrics->'review_count_lower_bound')='number'
               THEN (metrics->>'review_count_lower_bound')::bigint ELSE NULL END AS review_count_lower_bound,
             CASE WHEN jsonb_typeof(metrics->'good_rate_percent')='number'
               THEN (metrics->>'good_rate_percent')::numeric ELSE NULL END AS good_rate_percent,
             metrics,relevance_score,confidence,source_json_pointer
      FROM ranked WHERE identity_rank=1
      ORDER BY relevance_score DESC LIMIT 30
    `, [researchRequestId, latestJobId]);
    const products = dedupeProductRows([...specializedProducts.rows, ...genericProducts.rows]);
    const brands = await client.query<JsonObject>(`
      SELECT observation.provider_brand_id AS brand_id,observation.brand_name,
             observation.item_count,observation.relevance_score
      FROM business_brand_observation observation
      JOIN ai_enrichment_result enrichment ON enrichment.id=observation.enrichment_result_id
      WHERE observation.research_request_id=$1 AND enrichment.job_id=$2
      ORDER BY observation.item_count DESC NULLS LAST,observation.relevance_score DESC LIMIT 30
    `, [researchRequestId, latestJobId]);
    const properties = await client.query<JsonObject>(`
      SELECT observation.provider_property_id AS property_id,observation.property_name,
             observation.provider_value_id AS value_id,observation.property_value,
             observation.item_count,observation.relevance_score
      FROM business_property_observation observation
      JOIN ai_enrichment_result enrichment ON enrichment.id=observation.enrichment_result_id
      WHERE observation.research_request_id=$1 AND enrichment.job_id=$2
      ORDER BY observation.property_name,observation.item_count DESC NULLS LAST LIMIT 50
    `, [researchRequestId, latestJobId]);
    const contentEvidence = await client.query<JsonObject>(`
      SELECT query_row.endpoint_id,content.source_platform,'content'::text AS evidence_kind,
             source.provider_entity_id,content.title,content.summary,content.author,
             content.canonical_url,content.published_at,content.metrics,
             content.relevance_score,content.confidence,content.source_json_pointer
      FROM business_content_observation content
      JOIN social_search_item source ON source.id=content.source_social_item_id
      JOIN social_search_snapshot snapshot ON snapshot.id=source.snapshot_id
      JOIN external_query query_row ON query_row.id=snapshot.external_query_id
      JOIN ai_enrichment_result enrichment ON enrichment.id=content.enrichment_result_id
      WHERE content.research_request_id=$1 AND enrichment.job_id=$2
      ORDER BY content.relevance_score DESC,content.published_at DESC NULLS LAST LIMIT 50
    `, [researchRequestId, latestJobId]);
    const genericEvidence = await client.query<JsonObject>(`
      SELECT evidence.endpoint_id,evidence.source_platform,evidence.evidence_kind,
             evidence.provider_entity_id,evidence.title,evidence.summary,evidence.author,
             evidence.canonical_url,evidence.published_at,evidence.metrics,
             evidence.relevance_score,evidence.confidence,evidence.source_json_pointer
      FROM business_evidence_observation evidence
      JOIN ai_enrichment_result enrichment ON enrichment.id=evidence.enrichment_result_id
      WHERE evidence.research_request_id=$1 AND enrichment.job_id=$2
      ORDER BY evidence.relevance_score DESC,evidence.published_at DESC NULLS LAST LIMIT 50
    `, [researchRequestId, latestJobId]);
    const storedMetrics = await client.query<{ metric_name: string; metric_value: JsonObject; sample_count: number; confidence: number }>(`
      SELECT metric_name, metric_value, sample_count, confidence
      FROM research_metric WHERE research_request_id=$1 ORDER BY metric_name
    `, [researchRequestId]);
    const decisions = await client.query<{ decision: string; count: string }>(`
      SELECT result.decision, count(*)::text AS count
      FROM ai_enrichment_result result WHERE result.research_request_id=$1 AND result.job_id=$2
      GROUP BY result.decision
    `, [researchRequestId, latestJobId]);
    const decisionCounts = Object.fromEntries(decisions.rows.map((row) => [row.decision, Number(row.count)]));
    const intent = isRecord(request.structured_intent) ? request.structured_intent : {};
    const requestedMetrics = stringArray(intent.metrics);
    const metricValues: JsonObject = Object.fromEntries(storedMetrics.rows.map((row) => [row.metric_name, {
      ...row.metric_value, sampleCount: row.sample_count, confidence: row.confidence,
    }]));
    const priceGroups = new Map<string, number[]>();
    for (const row of products) {
      const amount = nullableNumber(row.price_amount ?? row.price_yuan);
      const currency = typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency)
        ? row.currency
        : row.price_yuan !== null && row.price_yuan !== undefined
          ? "CNY"
          : null;
      if (amount === null || amount < 0 || currency === null) continue;
      priceGroups.set(currency, [...(priceGroups.get(currency) ?? []), amount]);
    }
    for (const values of priceGroups.values()) values.sort((left, right) => left - right);
    if (!metricValues.price_band && priceGroups.size) {
      const bands = [...priceGroups.entries()].map(([currency, values]) => ({
        currency,
        minimum: values[0],
        p25: percentile(values, 0.25),
        median: percentile(values, 0.5),
        p75: percentile(values, 0.75),
        maximum: values.at(-1),
        sampleCount: values.length,
        method: "unweighted_provider_display_prices",
        confidence: confidenceForSample(values.length),
        ...(currency === "CNY" ? {
          minimumYuan: values[0],
          p25Yuan: percentile(values, 0.25),
          medianYuan: percentile(values, 0.5),
          p75Yuan: percentile(values, 0.75),
          maximumYuan: values.at(-1),
        } : {}),
      }));
      metricValues.price_band = bands.length === 1 ? bands[0]! : { currency: null, bands };
    }
    const salesRows = products.filter((row) =>
      row.sales_display !== null && row.sales_display !== undefined ||
      row.sales_lower_bound !== null && row.sales_lower_bound !== undefined);
    const hasSalesEvidence = salesRows.length > 0;
    if (!metricValues.sales_level && salesRows.length) {
      const knownLowerBounds = salesRows
        .map((row) => nullableInteger(row.sales_lower_bound))
        .filter((value): value is number => value !== null && value >= 0);
      metricValues.sales_level = {
        observations: salesRows.map((row) => ({
          itemId: row.item_id ?? null,
          display: row.sales_display ?? null,
          lowerBound: nullableInteger(row.sales_lower_bound),
          upperBound: nullableInteger(row.sales_upper_bound),
          qualifier: row.sales_qualifier ?? "unknown",
        })),
        maximumKnownLowerBound: knownLowerBounds.length ? Math.max(...knownLowerBounds) : null,
        exactValuesAvailable: salesRows.some((row) => row.sales_qualifier === "exact"),
        sampleCount: salesRows.length,
        method: "provider_sales_display_preserving_qualifier",
        confidence: confidenceForSample(salesRows.length),
      };
    }
    const evidence = [...contentEvidence.rows, ...genericEvidence.rows]
      .sort((left, right) => Number(right.relevance_score ?? 0) - Number(left.relevance_score ?? 0))
      .slice(0, 50);
    const availableMetricFields = [...new Set(
      evidence.flatMap((row) => isRecord(row.metrics) ? Object.keys(row.metrics) : []),
    )].sort();
    const availableMetrics = new Set(Object.keys(metricValues));
    if (availableMetricFields.some((field) => ["sales_display", "sales_lower_bound", "sales_upper_bound"].includes(field))) {
      availableMetrics.add("sales_level");
    }
    const availableMetricNames = [...availableMetrics].sort();
    const missingRequestedMetrics = requestedMetrics.filter((metric) => !availableMetrics.has(metric));
    const success = request.status === "completed";
    return {
      success,
      provider_completed: request.raw_state === "succeeded",
      processing_state: request.status,
      code: success ? 0 : request.provider_code ?? 500,
      message: success
        ? "SHUEHO 外部数据服务已完成采集、完整归档、质量判断和业务层晋级。"
        : request.raw_state === "succeeded"
          ? `JustOneAPI 调用已完成并完整归档，但 SHUEHO 数据处理状态为 ${request.status}。`
          : request.provider_message ?? `Research state: ${request.status}`,
      research_request_id: researchRequestId,
      raw_archive_id: request.raw_call_id,
      endpoint_id: request.endpoint_id,
      query_key: request.query_key,
      observed_at: request.observed_at.toISOString(),
      coverage: {
        acceptedProducts: products.length,
        acceptedBrands: brands.rowCount,
        acceptedProperties: properties.rowCount,
        acceptedContent: contentEvidence.rowCount,
        acceptedEvidence: evidence.length,
        promoted: decisionCounts.promote ?? 0,
        held: decisionCounts.hold ?? 0,
        rejected: decisionCounts.reject ?? 0,
        objective: typeof intent.objective === "string" ? intent.objective : null,
        requestedWindow: isRecord(intent.timeRange) ? intent.timeRange : null,
        windowEnforcement: typeof intent.windowEnforcement === "string" ? intent.windowEnforcement : null,
        requestedMetrics,
        availableMetrics: availableMetricNames,
        availableMetricFields,
        missingRequestedMetrics,
      },
      metrics: metricValues,
      products,
      brands: brands.rows,
      properties: properties.rows,
      evidence,
      exclusions: decisionCounts,
      limitations: [
        "结果仅来自本次查询及通过质量和相关性判断的证据。",
        ...(isRecord(intent.timeRange)
          ? ["缺少可验证发布时间或位于请求时间范围外的记录不会进入业务证据层。"]
          : []),
        ...(missingRequestedMetrics.length
          ? [`供应商本次可用证据未覆盖这些请求指标：${missingRequestedMetrics.join("、")}。`]
          : []),
        ...(hasSalesEvidence
          ? ["销量区间保留供应商原始口径；例如 1000+ 只表示下界，不代表精确销量。"]
          : []),
        ...(priceGroups.size
          ? ["价格带使用供应商返回的展示价格并保留原币种；不等同于全部规格或成交价。"]
          : []),
        "原始响应完整保存在 SQL 原始数据层，但不会通过 MCP 返回。",
      ],
    };
  });
}

async function persistQualityIssues(
  client: PoolClient,
  scope: ExternalDataScope,
  researchRequestId: string,
  entityType: string,
  entityId: string,
  quality: { status: string; reasons: string[] },
): Promise<void> {
  for (const reason of quality.reasons) {
    await client.query(`
      INSERT INTO data_quality_issue (
        tenant_id,workspace_id,research_request_id,entity_type,entity_id,severity,reason_code,details
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      ON CONFLICT DO NOTHING
    `, [scope.tenantId, scope.workspaceId, researchRequestId, entityType, entityId,
      quality.status === "rejected" ? "error" : "warning", reason,
      JSON.stringify({ qualityStatus: quality.status })]);
  }
}

function countCandidates(candidates: EnrichmentCandidate[]): JsonObject {
  return {
    total: candidates.length,
    items: candidates.filter((candidate) => candidate.entityType === "taobao_item").length,
    brands: candidates.filter((candidate) => candidate.entityType === "taobao_brand").length,
    propertyValues: candidates.filter((candidate) => candidate.entityType === "taobao_property_value").length,
    socialItems: candidates.filter((candidate) => candidate.entityType === "social_item").length,
    genericRecords: candidates.filter((candidate) => candidate.entityType === "generic_record").length,
    qualityRejected: candidates.filter((candidate) => candidate.quality.status === "rejected").length,
  };
}

function compactText(parts: string[]): string {
  return parts.filter(Boolean).join("；").slice(0, 4096);
}

function dedupeProductRows(rows: JsonObject[]): JsonObject[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const itemId = typeof row.item_id === "string" ? row.item_id : String(row.item_id ?? "");
    const source = typeof row.source_name === "string" ? row.source_name : "unknown";
    const key = `${source}:${itemId}`;
    if (!itemId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableInteger(value: unknown): number | null {
  const parsed = nullableNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function nullableTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? new Date(`${value.replace(" ", "T")}+08:00`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function taobaoItemUrl(value: unknown): string | null {
  const itemId = nullableText(value);
  return itemId && /^\d{5,32}$/.test(itemId)
    ? `https://item.taobao.com/item.htm?id=${encodeURIComponent(itemId)}`
    : null;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 1) return values[0] ?? 0;
  const index = (values.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return Number((((values[lower] ?? 0) * (1 - weight)) + ((values[upper] ?? 0) * weight)).toFixed(4));
}

function confidenceForSample(sampleCount: number): number {
  return Number(Math.min(0.95, 0.4 + Math.log10(Math.max(1, sampleCount)) * 0.25).toFixed(4));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
