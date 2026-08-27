import { config } from "./config.js";

export class LocalModelClient {
  async warmup(): Promise<void> {
    await this.health();
    await this.embed(["淘宝商品相关性预热"], "query");
    await this.embed(["淘宝商品证据预热"], "document");
    await this.rerank("淘宝商品相关性预热", ["淘宝商品证据预热"]);
  }

  async health(): Promise<Record<string, unknown>> {
    const response = await fetch(`${config.localModels.url}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new LocalModelError(`Local model health returned ${response.status}.`, "HEALTH_FAILED");
    const payload = await response.json() as unknown;
    if (!isRecord(payload)) throw new LocalModelError("Local model health returned invalid JSON.", "INVALID_RESPONSE");
    assertExpectedRuntime(payload);
    return payload;
  }

  async embed(texts: string[], inputType: "query" | "document"): Promise<number[][]> {
    if (!texts.length || texts.length > 64) throw new LocalModelError("Embedding batch size is invalid.", "INVALID_INPUT");
    const response = await this.post("/v1/embeddings", { input: texts, input_type: inputType });
    if (!Array.isArray(response.data)) throw new LocalModelError("Local embedding response is invalid.", "INVALID_RESPONSE");
    const embeddings = response.data.map((item) => {
      if (!isRecord(item) || !Array.isArray(item.embedding)) {
        throw new LocalModelError("Local embedding item is invalid.", "INVALID_RESPONSE");
      }
      const vector = item.embedding.map(Number);
      if (vector.length !== config.localModels.embeddingDimensions || vector.some((value) => !Number.isFinite(value))) {
        throw new LocalModelError("Local embedding dimensions are invalid.", "INVALID_RESPONSE");
      }
      return vector;
    });
    if (embeddings.length !== texts.length) {
      throw new LocalModelError("Local embedding response count does not match input.", "INVALID_RESPONSE");
    }
    return embeddings;
  }

  async rerank(query: string, documents: string[]): Promise<number[]> {
    if (!documents.length || documents.length > 50) throw new LocalModelError("Reranker batch size is invalid.", "INVALID_INPUT");
    const response = await this.post("/v1/rerank", {
      query,
      documents,
      instruction: "Determine whether each multilingual e-commerce record matches the target product across languages and supports the requested market metrics. Treat equivalent local-market terms and translations as matches. Reject cross-category contamination.",
    });
    if (!Array.isArray(response.results)) throw new LocalModelError("Local reranker response is invalid.", "INVALID_RESPONSE");
    const scores = new Array<number>(documents.length).fill(Number.NaN);
    for (const result of response.results) {
      if (!isRecord(result) || !Number.isInteger(result.index) || typeof result.relevance_score !== "number") continue;
      const index = result.index as number;
      if (index >= 0 && index < scores.length) scores[index] = result.relevance_score as number;
    }
    if (scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
      throw new LocalModelError("Local reranker scores are invalid.", "INVALID_RESPONSE");
    }
    return scores;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${config.localModels.url}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.localModels.token ? { Authorization: `Bearer ${config.localModels.token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.localModels.timeoutMs),
      });
    } catch (error) {
      throw new LocalModelError(`Local model request failed: ${safeError(error)}`, "UNAVAILABLE");
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new LocalModelError(`Local model returned ${response.status}: ${detail}`, "MODEL_FAILED");
    }
    const payload = await response.json() as unknown;
    if (!isRecord(payload)) throw new LocalModelError("Local model returned invalid JSON.", "INVALID_RESPONSE");
    return payload;
  }
}

export class LocalModelError extends Error {
  constructor(message: string, readonly code: "HEALTH_FAILED" | "INVALID_INPUT" | "INVALID_RESPONSE" | "UNAVAILABLE" | "MODEL_FAILED") {
    super(message);
    this.name = "LocalModelError";
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertExpectedRuntime(payload: Record<string, unknown>): void {
  const embedding = payload.embedding;
  const reranker = payload.reranker;
  if (payload.ok !== true || payload.fake !== false || !isRecord(embedding) || !isRecord(reranker)) {
    throw new LocalModelError("Local model runtime is unhealthy or uses fake inference.", "HEALTH_FAILED");
  }
  if (embedding.model !== config.localModels.embeddingModel ||
      embedding.revision !== config.localModels.embeddingRevision ||
      embedding.dimensions !== config.localModels.embeddingDimensions) {
    throw new LocalModelError("Local embedding model identity does not match the pinned warehouse configuration.", "HEALTH_FAILED");
  }
  if (reranker.model !== config.localModels.rerankerModel ||
      reranker.revision !== config.localModels.rerankerRevision) {
    throw new LocalModelError("Local reranker identity does not match the pinned warehouse configuration.", "HEALTH_FAILED");
  }
}
