# Local Retrieval Models

Loopback-only Qwen3 retrieval inference for SHUEHO External Data Service.

## Models

- `Qwen/Qwen3-Embedding-4B`, truncated and L2-normalized to 1024 dimensions;
- `Qwen/Qwen3-Reranker-4B`, cross-encoder scores converted to probabilities.

The downloader pins both repositories to the commit revisions recorded in `.env.example` and rejects any weight shard whose byte size or SHA-256 differs from the manifest. Health responses and warehouse model metadata retain those revisions so derived vectors and relevance decisions are reproducible.

Both models run locally through PyTorch Metal/MPS on Apple Silicon. The process rejects CPU fallback unless explicitly enabled outside production. Model weights live under the ignored `.runtime/models` directory and are never committed.

## Setup

```bash
npm run external-data:models:sync
npm run external-data:models:download
npm run external-data:models
```

The ignored `services/local-retrieval-models/.env` must contain the same `LOCAL_MODEL_INTERNAL_TOKEN` used by `apps/external-data/.env`, plus absolute local model paths.
Copy the non-secret defaults from `.env.example`; keep the inference batches small because request batch limits and Metal execution batches serve different purposes.

## Endpoints

- `GET /health` reports model identity, dimensions, device and lazy-load status;
- `POST /v1/embeddings` accepts at most 64 texts of at most 4096 characters;
- `POST /v1/rerank` accepts at most 50 documents of at most 4096 characters.

Embedding requests execute internally in batches of 4 and reranking in batches of 1 by default. These values bound unified-memory pressure while preserving the larger HTTP batch contract.

Inference endpoints require a bearer token. No CORS configuration is enabled, request bodies are not logged by application code, and a model error is returned to the warehouse pipeline rather than replaced with a lower-quality fallback.
