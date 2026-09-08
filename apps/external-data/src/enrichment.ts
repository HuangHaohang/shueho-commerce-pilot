import { config } from "./config.js";
import { candidateMetricAssessment, ENRICHMENT_VERSION } from "./evidence-assessment.js";
import { LocalModelClient } from "./local-model-client.js";
import { expandMultilingualQueryTerms } from "./market-localization.js";
import { lexicalRelevanceMany } from "./quality.js";
import type { EnrichmentCandidate, EnrichmentDecision, ResearchIntent } from "./types.js";

export async function enrichCandidates(input: {
  requestText: string;
  intent: ResearchIntent;
  candidates: EnrichmentCandidate[];
  models: LocalModelClient;
  additionalQueryTerms?: string[];
}): Promise<{ decisions: EnrichmentDecision[]; embeddings: Map<string, number[]> }> {
  const queryTerms = expandMultilingualQueryTerms([
    input.intent.targetProduct,
    input.intent.localizedKeyword,
    ...(input.intent.localizedKeywords ?? []),
    ...(input.additionalQueryTerms ?? []),
  ]);
  const queryText = buildEnrichmentQueryText(input.requestText, input.intent, queryTerms);
  const eligible = input.candidates.filter((candidate) => candidate.quality.status !== "rejected" && candidate.content.trim());
  const embeddings = new Map<string, number[]>();
  const embeddingScores = new Map<string, number>();
  const rerankScores = new Map<string, number>();

  if (eligible.length) {
    const queryEmbedding = (await input.models.embed([queryText], "query"))[0];
    if (!queryEmbedding) throw new Error("Local embedding model returned no query embedding.");
    for (const batch of batches(eligible, 64)) {
      const vectors = await input.models.embed(batch.map(scopeDocument), "document");
      for (let index = 0; index < batch.length; index += 1) {
        const candidate = batch[index];
        const vector = vectors[index];
        if (!candidate || !vector) throw new Error("Local embedding batch response is incomplete.");
        embeddings.set(candidate.entityId, vector);
        embeddingScores.set(candidate.entityId, cosine(queryEmbedding, vector));
      }
      // Retrieval vectors must still correspond to the complete stored content.
      // Scope admission uses descriptive text so metric presence cannot change it.
      const changed = batch.filter((candidate) => scopeDocument(candidate) !== candidate.content);
      if (changed.length) {
        const contentVectors = await input.models.embed(changed.map((candidate) => candidate.content), "document");
        for (let index = 0; index < changed.length; index += 1) {
          const candidate = changed[index];
          const vector = contentVectors[index];
          if (!candidate || !vector) throw new Error("Local content embedding batch response is incomplete.");
          embeddings.set(candidate.entityId, vector);
        }
      }
    }
    for (const batch of batches(eligible, 50)) {
      const scores = await input.models.rerank(queryText, batch.map(scopeDocument));
      for (let index = 0; index < batch.length; index += 1) {
        const candidate = batch[index];
        const score = scores[index];
        if (!candidate || score === undefined) throw new Error("Local reranker batch response is incomplete.");
        rerankScores.set(candidate.entityId, score);
      }
    }
  }

  const decisions = input.candidates.map((candidate): EnrichmentDecision => {
    const product = candidate.entityType === "taobao_item" || candidate.metadata.recordKind === "product";
    const lexicalDocument = product ? scopeDocument(candidate)
      : candidate.entityType === "taobao_brand" || candidate.entityType === "taobao_property_value"
      ? candidate.quality.normalizedValue ?? ""
      : candidate.content;
    const lexicalScore = lexicalRelevanceMany(queryTerms, input.requestText, lexicalDocument);
    const embeddingScore = embeddingScores.get(candidate.entityId) ?? null;
    const rerankScore = rerankScores.get(candidate.entityId) ?? null;
    const semanticScore = embeddingScore === null ? 0 : clamp((embeddingScore + 1) / 2);
    const relevanceScore = clamp((lexicalScore * 0.25) + (semanticScore * 0.25) + ((rerankScore ?? 0) * 0.5));
    const zeroCount = (candidate.entityType === "taobao_brand" || candidate.entityType === "taobao_property_value") &&
      typeof candidate.metadata.itemCount === "number" && candidate.metadata.itemCount <= 0;
    const metrics = candidateMetricAssessment(candidate);
    const embeddingMinScore = policyNumber(input.intent.qualityPolicy?.embeddingMinScore, config.localModels.embeddingMinScore);
    const rerankMinScore = policyNumber(input.intent.qualityPolicy?.rerankMinScore, config.localModels.rerankMinScore);
    const lexicalPromoteMinScore = policyNumber(input.intent.qualityPolicy?.lexicalPromoteMinScore, 0.6);
    // Admission does not use the weighted rank. A lexical hit cannot bypass the reranker.
    const modelSupported = (rerankScore ?? 0) >= rerankMinScore &&
      ((embeddingScore ?? -1) >= embeddingMinScore ||
        (lexicalScore >= lexicalPromoteMinScore && (embeddingScore ?? -1) >= embeddingMinScore - 0.08));
    const reasons = new Set(candidate.quality.reasons);
    if (lexicalScore >= 0.999) reasons.add("LEXICAL_TARGET_MENTION");
    reasons.add(modelSupported ? "MODEL_SCOPE_SUPPORTED" : "SCOPE_UNCONFIRMED");
    if (zeroCount) reasons.add("ZERO_PROVIDER_COUNT");
    if (metrics.price.status === "available") reasons.add("SUPPORTS_PRICE_ANALYSIS");
    if (metrics.sales.status === "available") reasons.add("SUPPORTS_SALES_ANALYSIS");
    if (product && metrics.price.status !== "available") reasons.add(String(metrics.price.reason));
    if (product && metrics.sales.status !== "available") reasons.add(String(metrics.sales.reason));

    const decision = candidate.quality.status === "rejected" ? "reject"
      : candidate.quality.status === "suspicious" || zeroCount || !modelSupported ? "hold" : "promote";
    // The legacy numeric column is not a calibrated probability. Public responses return null.
    const confidence = 0;
    const entityMatch = modelSupported ? "adjacent" : "unknown";
    const assessment = {
      version: ENRICHMENT_VERSION,
      scope: {
        status: candidate.quality.status === "rejected" ? "invalid_record"
          : decision === "promote" ? "model_supported" : "uncertain",
        basis: "immutable_research_request_and_model_relevance",
        homogeneousCohortVerified: false,
        thresholds: { embeddingMinScore, rerankMinScore, lexicalPromoteMinScore, lexicalEmbeddingAllowance: 0.08 },
      },
      metrics,
      ranking: { kind: "relevance_only", weights: { lexical: 0.25, embedding: 0.25, reranker: 0.5 }, calibratedProbability: false },
    };
    return {
      ...candidate,
      supportsPrice: metrics.price.status === "available",
      supportsSales: metrics.sales.status === "available",
      assessment,
      lexicalScore,
      embeddingScore,
      rerankScore,
      relevanceScore,
      confidence,
      entityMatch,
      reasonCodes: [...reasons].sort(),
      decision,
    };
  });
  return { decisions, embeddings };
}

/** Product scope is assessed from descriptive evidence, independently of numeric metrics. */
function scopeDocument(candidate: EnrichmentCandidate): string {
  if (candidate.entityType !== "taobao_item" && candidate.metadata.recordKind !== "product") return candidate.content;
  const title = typeof candidate.metadata.title === "string" ? candidate.metadata.title : candidate.quality.normalizedValue;
  return [title, typeof candidate.metadata.summary === "string" ? candidate.metadata.summary : ""]
    .filter(Boolean).join("；").slice(0, 4096);
}

export function buildEnrichmentQueryText(
  requestText: string,
  intent: ResearchIntent,
  queryTerms: string[] = [],
): string {
  const allTerms = expandMultilingualQueryTerms([
    intent.targetProduct,
    intent.localizedKeyword,
    ...(intent.localizedKeywords ?? []),
    ...queryTerms,
  ]);
  return [
    `用户确认的研究范围：${intent.originalRequest.trim() || requestText.trim()}`,
    intent.targetProduct ? `目标商品：${intent.targetProduct}` : "",
    ...allTerms.map((term) => `等价检索词：${term}`),
    ...intent.expectedCategories.map((category) => `研究范围包含：${category}`),
    ...intent.excludedCategories.map((category) => `研究范围排除：${category}`),
    "仅判断记录与用户研究范围的相关性。范围限制只来自用户要求，不自行缩小到某个子类；证据可能使用目标市场当地语言，跨语言等价商品词应视为匹配。价格、销量等指标是否存在另行核验，不能提高或降低商品范围相关性。",
  ].filter(Boolean).join("；").slice(0, 4096);
}

function policyNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1 ? value : fallback;
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length || !left.length) throw new Error("Embedding vectors have incompatible dimensions.");
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  if (!leftNorm || !rightNorm) return -1;
  return Math.min(1, Math.max(-1, dot / Math.sqrt(leftNorm * rightNorm)));
}

function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
