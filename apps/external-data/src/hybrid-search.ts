import { config } from "./config.js";
import { vectorLiteral, withScope } from "./database.js";
import { recordServiceAudit } from "./audit.js";
import { LocalModelClient } from "./local-model-client.js";
import { searchBusinessIndex } from "./search-index.js";
import type { JsonObject } from "./types.js";

type HybridCandidate = JsonObject & {
  result_key: string;
  title?: string | null;
  summary?: string | null;
  shop_name?: string | null;
  vector_rank?: number;
  elastic_rank?: number;
  vector_score?: number;
  elastic_score?: number | null;
};

type HybridSearchInput = {
  tenantId: string;
  workspaceId: string;
  query: string;
  limit: number;
  models?: LocalModelClient;
};

export async function hybridBusinessSearch(input: HybridSearchInput): Promise<JsonObject[]> {
  try {
    const results = await executeHybridBusinessSearch(input);
    await recordBusinessSearchAudit(input, "succeeded", results.length);
    return results;
  } catch (error) {
    await recordBusinessSearchAudit(input, "failed", 0, error).catch(() => undefined);
    throw error;
  }
}

async function executeHybridBusinessSearch(input: HybridSearchInput): Promise<JsonObject[]> {
  const models = input.models ?? new LocalModelClient();
  const queryVector = (await models.embed([input.query.slice(0, 4096)], "query"))[0];
  if (!queryVector) throw new Error("Local embedding model returned no search vector.");
  const vectorRows = await withScope(input, async (client) => {
    await client.query("SET LOCAL hnsw.iterative_scan = strict_order");
    await client.query("SET LOCAL hnsw.ef_search = 100");
    const result = await client.query<JsonObject>(`
      WITH nearest AS (
        SELECT document.entity_type, document.entity_id,document.research_request_id,
               1 - (document.embedding <=> $1::vector) AS vector_score
        FROM semantic_document document
        JOIN ai_enrichment_result enrichment
          ON enrichment.entity_type=document.entity_type
         AND enrichment.entity_id=document.entity_id
         AND enrichment.research_request_id=document.research_request_id
        WHERE enrichment.decision='promote'
        ORDER BY document.embedding <=> $1::vector
        LIMIT 50
      )
      SELECT 'product:' || product.id::text AS result_key, 'product' AS entity_type,
             product.id, product.title, NULL::text AS summary, product.shop_name,
             product.price_yuan, product.sales_display, product.relevance_score,
             nearest.vector_score,product.source_name,product.canonical_url,
             product.observed_at,product.research_request_id,product.query_key,
             'product'::text AS evidence_kind,
             jsonb_strip_nulls(jsonb_build_object(
               'price_yuan',product.price_yuan,
               'sales_display',product.sales_display,
               'sales_lower_bound',product.sales_lower_bound,
               'sales_upper_bound',product.sales_upper_bound,
               'sales_qualifier',product.sales_qualifier
             )) AS metrics,
             NULL::timestamptz AS published_at,
             'ai_promoted_text'::text AS quality_basis,
             product.confidence
      FROM nearest
      JOIN business_product_observation product
        ON nearest.entity_type='taobao_item' AND product.source_item_id=nearest.entity_id
       AND product.research_request_id=nearest.research_request_id
      UNION ALL
      SELECT 'content:' || content.id::text AS result_key, 'content' AS entity_type,
             content.id, content.title, content.summary, NULL::text AS shop_name,
             NULL::numeric AS price_yuan, NULL::text AS sales_display,
             content.relevance_score, nearest.vector_score,content.source_name,
             content.canonical_url,content.observed_at,content.research_request_id,
             content.query_key,'content'::text AS evidence_kind,content.metrics,
             content.published_at,'ai_promoted_text'::text AS quality_basis,
             content.confidence
      FROM nearest
      JOIN business_content_observation content
        ON nearest.entity_type='social_item' AND content.source_social_item_id=nearest.entity_id
       AND content.research_request_id=nearest.research_request_id
      UNION ALL
      SELECT 'brand:' || brand.id::text AS result_key, 'brand' AS entity_type,
             brand.id, brand.brand_name AS title,
             ('覆盖商品数：' || COALESCE(brand.item_count, 0)::text) AS summary,
             NULL::text AS shop_name, NULL::numeric AS price_yuan,
             NULL::text AS sales_display, brand.relevance_score, nearest.vector_score,
             '淘宝品牌筛选'::text AS source_name,NULL::text AS canonical_url,
             brand.observed_at,brand.research_request_id,brand.query_key,
             'brand'::text AS evidence_kind,
             jsonb_build_object('item_count',brand.item_count) AS metrics,
             NULL::timestamptz AS published_at,
             'ai_promoted_text'::text AS quality_basis,NULL::double precision AS confidence
      FROM nearest
      JOIN business_brand_observation brand
        ON nearest.entity_type='taobao_brand' AND brand.source_brand_id=nearest.entity_id
       AND brand.research_request_id=nearest.research_request_id
      UNION ALL
      SELECT 'property:' || property.id::text AS result_key, 'property' AS entity_type,
             property.id, (property.property_name || '：' || property.property_value) AS title,
             ('覆盖商品数：' || COALESCE(property.item_count, 0)::text) AS summary,
             NULL::text AS shop_name, NULL::numeric AS price_yuan,
             NULL::text AS sales_display, property.relevance_score, nearest.vector_score,
             '淘宝属性筛选'::text AS source_name,NULL::text AS canonical_url,
             property.observed_at,property.research_request_id,property.query_key,
             'property'::text AS evidence_kind,
             jsonb_build_object('item_count',property.item_count) AS metrics,
             NULL::timestamptz AS published_at,
             'ai_promoted_text'::text AS quality_basis,NULL::double precision AS confidence
      FROM nearest
      JOIN business_property_observation property
        ON nearest.entity_type='taobao_property_value' AND property.source_property_value_id=nearest.entity_id
       AND property.research_request_id=nearest.research_request_id
      UNION ALL
      SELECT 'evidence:' || evidence.id::text AS result_key, 'evidence' AS entity_type,
             evidence.id, evidence.title, evidence.summary, NULL::text AS shop_name,
             NULL::numeric AS price_yuan, NULL::text AS sales_display,
             evidence.relevance_score, nearest.vector_score,evidence.source_platform AS source_name,
             evidence.canonical_url,evidence.observed_at,evidence.research_request_id,
             evidence.query_key,evidence.evidence_kind,evidence.metrics,
             evidence.published_at,'ai_promoted_text'::text AS quality_basis,
             evidence.confidence
      FROM nearest
      JOIN business_evidence_observation evidence
        ON nearest.entity_type='generic_record' AND evidence.source_record_id=nearest.entity_id
       AND evidence.research_request_id=nearest.research_request_id
      ORDER BY vector_score DESC
      LIMIT 50
    `, [vectorLiteral(queryVector)]);
    return result.rows;
  });
  const elasticRows = await searchBusinessIndex({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    query: input.query,
    limit: 50,
  });

  const merged = new Map<string, HybridCandidate>();
  vectorRows.forEach((row, index) => {
    const key = String(row.result_key);
    merged.set(key, { ...row, result_key: key, vector_rank: index + 1, vector_score: Number(row.vector_score) });
  });
  elasticRows.forEach((row, index) => {
    const key = `${String(row.entity_type)}:${String(row.id)}`;
    const existing = merged.get(key) ?? { ...row, result_key: key };
    merged.set(key, { ...existing, ...row, result_key: key, elastic_rank: index + 1, elastic_score: nullableNumber(row.elastic_score) });
  });
  const ranked = [...merged.values()]
    .map((candidate) => ({
      ...candidate,
      reciprocal_rank_score:
        (candidate.vector_rank ? 1 / (60 + candidate.vector_rank) : 0) +
        (candidate.elastic_rank ? 1 / (60 + candidate.elastic_rank) : 0),
    }))
    .sort((left, right) => right.reciprocal_rank_score - left.reciprocal_rank_score)
    .slice(0, 20);
  if (!ranked.length) return [];
  const rerankScores = await models.rerank(
    input.query.slice(0, 4096),
    ranked.map((candidate) => [candidate.title, candidate.summary, candidate.shop_name].filter(Boolean).join("；").slice(0, 4096)),
  );
  return ranked
    .map((candidate, index) => ({ ...candidate, rerank_score: rerankScores[index] ?? 0 }))
    .filter((candidate) => Number(candidate.rerank_score) >= config.localModels.rerankMinScore)
    .sort((left, right) => Number(right.rerank_score) - Number(left.rerank_score))
    .slice(0, input.limit)
    .map(curateBusinessSearchResult);
}

async function recordBusinessSearchAudit(
  input: HybridSearchInput,
  outcome: "succeeded" | "failed",
  resultCount: number,
  error?: unknown,
): Promise<void> {
  await withScope(input, async (client) => recordServiceAudit(client, input, {
    action: "business_search.read",
    outcome,
    metadata: {
      resultCount,
      limit: input.limit,
      ...(error ? { errorType: error instanceof Error ? error.name : "UnknownError" } : {}),
    },
  }));
}

export function curateBusinessSearchResult(candidate: JsonObject): JsonObject {
  return {
    evidence_id: candidate.id,
    entity_type: candidate.entity_type,
    evidence_kind: candidate.evidence_kind ?? candidate.entity_type,
    title: candidate.title ?? null,
    summary: candidate.summary ?? null,
    shop_name: candidate.shop_name ?? null,
    price_yuan: candidate.price_yuan ?? null,
    sales_display: candidate.sales_display ?? null,
    source_name: candidate.source_name ?? null,
    canonical_url: candidate.canonical_url ?? null,
    metrics: isRecord(candidate.metrics) ? candidate.metrics : {},
    published_at: candidate.published_at ?? null,
    observed_at: candidate.observed_at,
    research_request_id: candidate.research_request_id,
    query_key: candidate.query_key,
    quality_basis: candidate.quality_basis ?? "ai_promoted_text",
    relevance_score: candidate.relevance_score,
    confidence: candidate.confidence ?? null,
    retrieval_score: candidate.rerank_score,
  };
}

function nullableNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
