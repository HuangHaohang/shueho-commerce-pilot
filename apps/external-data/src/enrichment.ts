import { config } from "./config.js";
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
      const vectors = await input.models.embed(batch.map((candidate) => candidate.content), "document");
      for (let index = 0; index < batch.length; index += 1) {
        const candidate = batch[index];
        const vector = vectors[index];
        if (!candidate || !vector) throw new Error("Local embedding batch response is incomplete.");
        embeddings.set(candidate.entityId, vector);
        embeddingScores.set(candidate.entityId, cosine(queryEmbedding, vector));
      }
    }
    for (const batch of batches(eligible, 50)) {
      const scores = await input.models.rerank(queryText, batch.map((candidate) => candidate.content));
      for (let index = 0; index < batch.length; index += 1) {
        const candidate = batch[index];
        const score = scores[index];
        if (!candidate || score === undefined) throw new Error("Local reranker batch response is incomplete.");
        rerankScores.set(candidate.entityId, score);
      }
    }
  }

  const decisions = input.candidates.map((candidate): EnrichmentDecision => {
    const lexicalDocument = candidate.entityType === "taobao_brand" || candidate.entityType === "taobao_property_value"
      ? candidate.quality.normalizedValue ?? ""
      : candidate.content;
    const lexicalScore = lexicalRelevanceMany(queryTerms, input.requestText, lexicalDocument);
    const embeddingScore = embeddingScores.get(candidate.entityId) ?? null;
    const rerankScore = rerankScores.get(candidate.entityId) ?? null;
    const semanticScore = embeddingScore === null ? 0 : clamp((embeddingScore + 1) / 2);
    const relevanceScore = clamp((lexicalScore * 0.25) + (semanticScore * 0.25) + ((rerankScore ?? 0) * 0.5));
    const zeroCount = (candidate.entityType === "taobao_brand" || candidate.entityType === "taobao_property_value") &&
      typeof candidate.metadata.itemCount === "number" && candidate.metadata.itemCount <= 0;
    const categoryMismatch = obviousCategoryMismatch(input.intent.targetProduct, candidate.content);
    const embeddingMinScore = policyNumber(input.intent.qualityPolicy?.embeddingMinScore, config.localModels.embeddingMinScore);
    const rerankMinScore = policyNumber(input.intent.qualityPolicy?.rerankMinScore, config.localModels.rerankMinScore);
    const lexicalPromoteMinScore = policyNumber(input.intent.qualityPolicy?.lexicalPromoteMinScore, 0.6);
    const holdRelevanceMinScore = policyNumber(input.intent.qualityPolicy?.holdRelevanceMinScore, 0.2);
    const passModel = (rerankScore ?? 0) >= rerankMinScore &&
      (embeddingScore ?? -1) >= embeddingMinScore && !categoryMismatch;
    const exact = lexicalScore >= 0.999;
    const lexicalSupported = lexicalScore >= lexicalPromoteMinScore &&
      ((embeddingScore ?? -1) >= embeddingMinScore - 0.08 || (rerankScore ?? 0) >= 0.2);
    const adjacent = !exact && (
      lexicalScore >= 0.25 || passModel || lexicalSupported || relevanceScore >= holdRelevanceMinScore
    );
    const reasons = new Set(candidate.quality.reasons);
    if (exact) reasons.add("EXACT_TARGET_MATCH");
    else if (passModel || lexicalSupported || lexicalScore >= 0.25) reasons.add("SEMANTIC_TARGET_MATCH");
    else reasons.add("INSUFFICIENT_RELEVANCE_EVIDENCE");
    if (zeroCount) reasons.add("ZERO_PROVIDER_COUNT");
    if (categoryMismatch) {
      reasons.add("CROSS_CATEGORY_CONTAMINATION");
      reasons.add("TARGET_MISMATCH");
    }
    if (candidate.supportsPrice) reasons.add("SUPPORTS_PRICE_ANALYSIS");
    if (candidate.supportsSales) reasons.add("SUPPORTS_SALES_ANALYSIS");

    let decision: "promote" | "hold" | "reject";
    if (candidate.quality.status === "rejected" || categoryMismatch) decision = "reject";
    else if (candidate.quality.status === "suspicious" || zeroCount) decision = "hold";
    else if (exact || passModel || lexicalSupported) decision = "promote";
    else decision = "hold";

    const entityMatch = categoryMismatch ? "irrelevant" : exact ? "exact" : adjacent ? "adjacent" : "unknown";
    const confidence = decision === "reject" && candidate.quality.status === "rejected"
      ? 0.99
      : clamp(0.35 + Math.abs(relevanceScore - 0.5) + (candidate.quality.status === "valid" ? 0.1 : 0));
    return {
      ...candidate,
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

const CATEGORY_CONFLICTS: Array<{ target: RegExp; forbidden: RegExp }> = [
  { target: /勺|锅|铲|餐具|厨具|刀叉|筷/, forbidden: /手机|电脑|笔记本|RTX\d*|显卡|处理器|硬盘|打印机|路由器/i },
  { target: /服装|衣|裤|裙|鞋/, forbidden: /手机|电脑|显卡|处理器|锅铲|餐具/i },
  { target: /手机|电脑|数码|显卡|处理器/, forbidden: /锅铲|餐具|裙|女裤|毛绒玩具/i },
];

function obviousCategoryMismatch(target: string | null, content: string): boolean {
  if (!target) return false;
  return CATEGORY_CONFLICTS.some((rule) => rule.target.test(target) && rule.forbidden.test(content));
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
    requestText.trim(),
    intent.targetProduct ? `目标商品：${intent.targetProduct}` : "",
    ...allTerms.map((term) => `等价检索词：${term}`),
    intent.metrics.length ? `需要支持的指标：${intent.metrics.join("、")}` : "",
    "证据可能使用目标市场当地语言；跨语言等价商品词应视为匹配。只接受与目标商品类目相符的公开市场证据，排除手机、电脑等跨类目污染。",
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
