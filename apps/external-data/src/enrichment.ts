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
  const queries = buildEnrichmentQueries(input.intent, queryTerms);
  const eligible = input.candidates.filter((candidate) => candidate.quality.status !== "rejected" && candidate.content.trim());
  const embeddings = new Map<string, number[]>();
  const excludedMatches = new Set<string>();
  const scopeVectors = new Map<string, number[]>();
  const variantScores = new Map<string, Array<{ embedding: number; rerank: number }>>();
  const embeddingMinScore = policyNumber(input.intent.qualityPolicy?.embeddingMinScore, config.localModels.embeddingMinScore);
  const rerankMinScore = policyNumber(input.intent.qualityPolicy?.rerankMinScore, config.localModels.rerankMinScore);

  if (eligible.length && queries.length) {
    const queryEmbeddings = await input.models.embed(queries, "query");
    if (queryEmbeddings.length !== queries.length) throw new Error("Local query embedding batch is incomplete.");
    for (const batch of batches(eligible, 64)) {
      const vectors = await input.models.embed(batch.map(scopeDocument), "document");
      for (let index = 0; index < batch.length; index += 1) {
        const candidate = batch[index];
        const vector = vectors[index];
        if (!candidate || !vector) throw new Error("Local embedding batch response is incomplete.");
        embeddings.set(candidate.entityId, vector);
        scopeVectors.set(candidate.entityId, vector);
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
    for (let variant = 0; variant < queries.length; variant += 1) {
      for (const batch of batches(eligible, 50)) {
        const scores = await input.models.rerank(queries[variant]!, batch.map(scopeDocument));
        for (let index = 0; index < batch.length; index += 1) {
          const candidate = batch[index];
          const score = scores[index];
          if (!candidate || score === undefined) throw new Error("Local reranker batch response is incomplete.");
          const pairs = variantScores.get(candidate.entityId) ?? [];
          pairs.push({ embedding: cosine(queryEmbeddings[variant]!, scopeVectors.get(candidate.entityId)!), rerank: score });
          variantScores.set(candidate.entityId, pairs);
        }
      }
    }
  }

  // Exclusions are positive classification questions of their own, not negated
  // terms inside a retrieval query (which can score the excluded material highly).
  for (const exclusion of queries.length ? expandMultilingualQueryTerms(input.intent.excludedCategories) : []) {
    for (const batch of batches(eligible, 50)) {
      const scores = await input.models.rerank(exclusion, batch.map(scopeDocument));
      if (scores.length !== batch.length) throw new Error("Local exclusion batch is incomplete.");
      batch.forEach((candidate, index) => {
        if (scores[index]! >= rerankMinScore) excludedMatches.add(candidate.entityId);
      });
    }
  }

  const decisions = input.candidates.map((candidate): EnrichmentDecision => {
    const product = candidate.entityType === "taobao_item" || candidate.metadata.recordKind === "product";
    const lexicalDocument = product ? scopeDocument(candidate)
      : candidate.entityType === "taobao_brand" || candidate.entityType === "taobao_property_value"
      ? candidate.quality.normalizedValue ?? ""
      : candidate.content;
    const lexicalScore = lexicalRelevanceMany(queryTerms, "", lexicalDocument);
    const supported = (pair: { embedding: number; rerank: number }) =>
      pair.rerank >= rerankMinScore && pair.embedding >= embeddingMinScore;
    // Both gates must pass on the SAME query variant; never combine unrelated maxima.
    const pairs = variantScores.get(candidate.entityId) ?? [];
    const best = [...pairs].sort((a, b) => Number(supported(b)) - Number(supported(a)) || b.rerank - a.rerank)[0];
    const embeddingScore = best?.embedding ?? null;
    const rerankScore = best?.rerank ?? null;
    const relevanceScore = rerankScore ?? 0;
    const zeroCount = (candidate.entityType === "taobao_brand" || candidate.entityType === "taobao_property_value") &&
      typeof candidate.metadata.itemCount === "number" && candidate.metadata.itemCount <= 0;
    const metrics = candidateMetricAssessment(candidate);
    const modelSupported = best !== undefined && supported(best);
    const reasons = new Set(candidate.quality.reasons);
    if (lexicalScore >= 0.999) reasons.add("LEXICAL_TARGET_MENTION");
    if (candidate.quality.status !== "rejected") reasons.add(modelSupported ? "MODEL_SCOPE_SUPPORTED" : "SCOPE_UNCONFIRMED");
    if (!queries.length) reasons.add("SEMANTIC_SCOPE_MISSING");
    if (excludedMatches.has(candidate.entityId)) reasons.add("EXCLUDED_SCOPE_MATCH");
    if (zeroCount) reasons.add("ZERO_PROVIDER_COUNT");
    if (metrics.price.status === "available") reasons.add("SUPPORTS_PRICE_ANALYSIS");
    if (metrics.sales.status === "available") reasons.add("SUPPORTS_SALES_ANALYSIS");
    if (product && metrics.price.status !== "available") reasons.add(String(metrics.price.reason));
    if (product && metrics.sales.status !== "available") reasons.add(String(metrics.sales.reason));

    const decision = candidate.quality.status === "rejected" ? "reject"
      : candidate.quality.status === "suspicious" || zeroCount || !modelSupported || excludedMatches.has(candidate.entityId) ? "hold" : "promote";
    // The legacy numeric column is not a calibrated probability. Public responses return null.
    const confidence = 0;
    const entityMatch = modelSupported ? "adjacent" : "unknown";
    const assessment = {
      version: ENRICHMENT_VERSION,
      scope: {
        status: candidate.quality.status === "rejected" ? "invalid_record"
          : excludedMatches.has(candidate.entityId) ? "excluded_scope_match"
          : decision === "promote" ? "model_supported" : "uncertain",
        basis: "immutable_structured_scope_and_model_relevance",
        queryContract: "semantic_variants_v1",
        variantCount: queries.length,
        homogeneousCohortVerified: false,
        thresholds: { embeddingMinScore, rerankMinScore },
      },
      metrics,
      ranking: { kind: "relevance_only", basis: "reranker_score", calibratedProbability: false },
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

/**
 * Queries contain semantic scope only. Instructions belong in the model's instruction
 * channel; dates, output size, ranking and requested metrics are independent checks.
 * Localized/script-equivalent terms are alternatives, never a conjunctive checklist.
 */
export function buildEnrichmentQueries(intent: ResearchIntent, queryTerms: string[] = []): string[] {
  const terms = expandMultilingualQueryTerms([
    intent.targetProduct, intent.localizedKeyword, ...(intent.localizedKeywords ?? []), ...queryTerms,
  ]);
  const scopes = intent.expectedCategories.filter(category =>
    !terms.includes(category.normalize("NFKC").trim()));
  const base = terms.length ? terms : scopes.splice(0);
  return base.map(term => [
    term,
    ...scopes.map(scope => `Required scope: ${scope}`),

  ].join("\n")).filter(Boolean);
}

/** Compatibility helper for callers needing the primary semantic query. */
export function buildEnrichmentQueryText(
  _requestText: string, intent: ResearchIntent, queryTerms: string[] = [],
): string {
  return buildEnrichmentQueries(intent, queryTerms)[0] ?? "";
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
