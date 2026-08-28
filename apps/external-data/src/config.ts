import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  EXTERNAL_DATA_HOST: z.string().default("127.0.0.1"),
  EXTERNAL_DATA_PORT: z.coerce.number().int().min(1).max(65535).default(8791),
  EXTERNAL_DATA_ALLOWED_HOSTS: z.string().default("127.0.0.1:8791,localhost:8791"),
  EXTERNAL_DATA_INTERNAL_TOKEN: z.string().default(""),
  EXTERNAL_DATA_DATABASE_URL: z.string().url(),
  EXTERNAL_DATA_MIGRATION_DATABASE_URL: z.string().url().optional(),
  EXTERNAL_DATA_ELASTICSEARCH_URL: z.string().url().default("http://127.0.0.1:59200"),
  EXTERNAL_DATA_ELASTICSEARCH_INDEX: z.string().regex(/^[a-z0-9_-]+$/).default("commerce-business-products-v1"),
  JUSTONEAPI_API_BASE_URL: z.string().url().default("https://api.justoneapi.com"),
  JUSTONEAPI_API_TOKEN: z.string().default(""),
  JUSTONEAPI_API_TIMEOUT_MS: z.coerce.number().int().min(60_000).max(180_000).default(120_000),
  JUSTONEAPI_API_MAX_RESPONSE_BYTES: z.coerce.number().int().min(65_536).max(67_108_864).default(67_108_864),
  LOCAL_RETRIEVAL_MODEL_URL: z.string().url().default("http://127.0.0.1:8792"),
  LOCAL_MODEL_INTERNAL_TOKEN: z.string().default(""),
  LOCAL_RETRIEVAL_MODEL_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(300_000).default(180_000),
  LOCAL_EMBEDDING_MODEL: z.string().default("Qwen/Qwen3-Embedding-4B"),
  LOCAL_EMBEDDING_MODEL_REVISION: z.string().regex(/^[a-f0-9]{40}$/).default("5cf2132abc99cad020ac570b19d031efec650f2b"),
  LOCAL_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(32).max(2560).default(1024),
  LOCAL_RERANKER_MODEL: z.string().default("Qwen/Qwen3-Reranker-4B"),
  LOCAL_RERANKER_MODEL_REVISION: z.string().regex(/^[a-f0-9]{40}$/).default("22e683669bc0f0bd69640a1354a6d0aebcfeede5"),
  EXTERNAL_DATA_EMBEDDING_MIN_SCORE: z.coerce.number().min(-1).max(1).default(0.42),
  EXTERNAL_DATA_RERANK_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.55),
  EXTERNAL_DATA_INDEX_WORKER_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  EXTERNAL_DATA_MARKETPLACE_PLAN_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
});

const parsed = envSchema.parse(process.env);

if (parsed.LOCAL_EMBEDDING_DIMENSIONS !== 1024) {
  throw new Error("This warehouse schema is fixed to LOCAL_EMBEDDING_DIMENSIONS=1024.");
}
if (parsed.NODE_ENV === "production") {
  if (parsed.EXTERNAL_DATA_INTERNAL_TOKEN.length < 32) {
    throw new Error("EXTERNAL_DATA_INTERNAL_TOKEN must contain at least 32 characters in production.");
  }
  if (parsed.LOCAL_MODEL_INTERNAL_TOKEN.length < 32) {
    throw new Error("LOCAL_MODEL_INTERNAL_TOKEN must contain at least 32 characters in production.");
  }
  if (!parsed.JUSTONEAPI_API_TOKEN) {
    throw new Error("JUSTONEAPI_API_TOKEN is required in production.");
  }
}

export const config = {
  environment: parsed.NODE_ENV,
  host: parsed.EXTERNAL_DATA_HOST,
  port: parsed.EXTERNAL_DATA_PORT,
  allowedHosts: new Set(parsed.EXTERNAL_DATA_ALLOWED_HOSTS.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)),
  internalToken: parsed.EXTERNAL_DATA_INTERNAL_TOKEN,
  databaseUrl: parsed.EXTERNAL_DATA_DATABASE_URL,
  migrationDatabaseUrl: parsed.EXTERNAL_DATA_MIGRATION_DATABASE_URL,
  elasticsearchUrl: parsed.EXTERNAL_DATA_ELASTICSEARCH_URL,
  elasticsearchIndex: parsed.EXTERNAL_DATA_ELASTICSEARCH_INDEX,
  justOneApi: {
    baseUrl: parsed.JUSTONEAPI_API_BASE_URL.replace(/\/$/, ""),
    token: parsed.JUSTONEAPI_API_TOKEN,
    timeoutMs: parsed.JUSTONEAPI_API_TIMEOUT_MS,
    maxResponseBytes: parsed.JUSTONEAPI_API_MAX_RESPONSE_BYTES,
  },
  localModels: {
    url: parsed.LOCAL_RETRIEVAL_MODEL_URL.replace(/\/$/, ""),
    token: parsed.LOCAL_MODEL_INTERNAL_TOKEN,
    timeoutMs: parsed.LOCAL_RETRIEVAL_MODEL_TIMEOUT_MS,
    embeddingModel: parsed.LOCAL_EMBEDDING_MODEL,
    embeddingRevision: parsed.LOCAL_EMBEDDING_MODEL_REVISION,
    embeddingVersion: `${parsed.LOCAL_EMBEDDING_MODEL}@${parsed.LOCAL_EMBEDDING_MODEL_REVISION}`,
    embeddingDimensions: parsed.LOCAL_EMBEDDING_DIMENSIONS,
    rerankerModel: parsed.LOCAL_RERANKER_MODEL,
    rerankerRevision: parsed.LOCAL_RERANKER_MODEL_REVISION,
    rerankerVersion: `${parsed.LOCAL_RERANKER_MODEL}@${parsed.LOCAL_RERANKER_MODEL_REVISION}`,
    embeddingMinScore: parsed.EXTERNAL_DATA_EMBEDDING_MIN_SCORE,
    rerankMinScore: parsed.EXTERNAL_DATA_RERANK_MIN_SCORE,
  },
  indexWorkerIntervalMs: parsed.EXTERNAL_DATA_INDEX_WORKER_INTERVAL_MS,
  marketplacePlanTtlMs: parsed.EXTERNAL_DATA_MARKETPLACE_PLAN_TTL_MINUTES * 60_000,
};
