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
        SELECT document.entity_type, document.entity_id,
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
             nearest.vector_score
      FROM nearest
      JOIN business_product_observation product
        ON nearest.entity_type='taobao_item' AND product.source_item_id=nearest.entity_id
      UNION ALL
      SELECT 'content:' || content.id::text AS result_key, 'content' AS entity_type,
             content.id, content.title, content.summary, NULL::text AS shop_name,
             NULL::numeric AS price_yuan, NULL::text AS sales_display,
             content.relevance_score, nearest.vector_score
      FROM nearest
      JOIN business_content_observation content
        ON nearest.entity_type='social_item' AND content.source_social_item_id=nearest.entity_id
      UNION ALL
      SELECT 'brand:' || brand.id::text AS result_key, 'brand' AS entity_type,
             brand.id, brand.brand_name AS title,
             ('覆盖商品数：' || COALESCE(brand.item_count, 0)::text) AS summary,
             NULL::text AS shop_name, NULL::numeric AS price_yuan,
             NULL::text AS sales_display, brand.relevance_score, nearest.vector_score
      FROM nearest
      JOIN business_brand_observation brand
        ON nearest.entity_type='taobao_brand' AND brand.source_brand_id=nearest.entity_id
      UNION ALL
      SELECT 'property:' || property.id::text AS result_key, 'property' AS entity_type,
             property.id, (property.property_name || '：' || property.property_value) AS title,
             ('覆盖商品数：' || COALESCE(property.item_count, 0)::text) AS summary,
             NULL::text AS shop_name, NULL::numeric AS price_yuan,
             NULL::text AS sales_display, property.relevance_score, nearest.vector_score
      FROM nearest
      JOIN business_property_observation property
        ON nearest.entity_type='taobao_property_value' AND property.source_property_value_id=nearest.entity_id
      UNION ALL
      SELECT 'evidence:' || evidence.id::text AS result_key, 'evidence' AS entity_type,
             evidence.id, evidence.title, evidence.summary, NULL::text AS shop_name,
             NULL::numeric AS price_yuan, NULL::text AS sales_display,
             evidence.relevance_score, nearest.vector_score
      FROM nearest
      JOIN business_evidence_observation evidence
        ON nearest.entity_type='generic_record' AND evidence.source_record_id=nearest.entity_id
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
    entity_type: candidate.entity_type,
    id: candidate.id,
    title: candidate.title ?? null,
    summary: candidate.summary ?? null,
    shop_name: candidate.shop_name ?? null,
    price_yuan: candidate.price_yuan ?? null,
    sales_display: candidate.sales_display ?? null,
    source_name: candidate.source_name ?? null,
    canonical_url: candidate.canonical_url ?? null,
    observed_at: candidate.observed_at,
    research_request_id: candidate.research_request_id,
    query_key: candidate.query_key,
    relevance_score: candidate.relevance_score,
    retrieval_score: candidate.rerank_score,
  };
}

function nullableNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
