from __future__ import annotations

import hashlib
import hmac
import os
import threading
from pathlib import Path
from typing import Literal

import numpy as np
import torch
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator


load_dotenv(Path(__file__).resolve().parents[2] / ".env")

EMBEDDING_MODEL = os.getenv("LOCAL_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-4B")
RERANKER_MODEL = os.getenv("LOCAL_RERANKER_MODEL", "Qwen/Qwen3-Reranker-4B")
EMBEDDING_MODEL_DISPLAY = os.getenv("LOCAL_EMBEDDING_MODEL_DISPLAY", "Qwen/Qwen3-Embedding-4B")
RERANKER_MODEL_DISPLAY = os.getenv("LOCAL_RERANKER_MODEL_DISPLAY", "Qwen/Qwen3-Reranker-4B")
EMBEDDING_MODEL_REVISION = os.getenv(
    "LOCAL_EMBEDDING_MODEL_REVISION", "5cf2132abc99cad020ac570b19d031efec650f2b"
)
RERANKER_MODEL_REVISION = os.getenv(
    "LOCAL_RERANKER_MODEL_REVISION", "22e683669bc0f0bd69640a1354a6d0aebcfeede5"
)
EMBEDDING_DIMENSIONS = int(os.getenv("LOCAL_EMBEDDING_DIMENSIONS", "1024"))
MODEL_TOKEN = os.getenv("LOCAL_MODEL_INTERNAL_TOKEN", "")
FAKE_MODE = os.getenv("LOCAL_MODEL_FAKE_MODE", "false").lower() == "true"
ALLOW_CPU = os.getenv("LOCAL_MODEL_ALLOW_CPU", "false").lower() == "true"
MAX_TEXT_CHARS = int(os.getenv("LOCAL_MODEL_MAX_TEXT_CHARS", "4096"))
MAX_EMBEDDING_INPUTS = int(os.getenv("LOCAL_MODEL_MAX_EMBEDDING_INPUTS", "64"))
MAX_RERANK_DOCUMENTS = int(os.getenv("LOCAL_MODEL_MAX_RERANK_DOCUMENTS", "50"))
EMBEDDING_INFERENCE_BATCH_SIZE = int(os.getenv("LOCAL_EMBEDDING_INFERENCE_BATCH_SIZE", "4"))
RERANK_INFERENCE_BATCH_SIZE = int(os.getenv("LOCAL_RERANK_INFERENCE_BATCH_SIZE", "1"))

if EMBEDDING_DIMENSIONS < 32 or EMBEDDING_DIMENSIONS > 2560:
    raise RuntimeError("LOCAL_EMBEDDING_DIMENSIONS must be between 32 and 2560.")
if len(MODEL_TOKEN) < 32:
    raise RuntimeError("LOCAL_MODEL_INTERNAL_TOKEN must contain at least 32 characters.")
if not 1 <= EMBEDDING_INFERENCE_BATCH_SIZE <= MAX_EMBEDDING_INPUTS:
    raise RuntimeError("LOCAL_EMBEDDING_INFERENCE_BATCH_SIZE is outside the allowed request batch.")
if not 1 <= RERANK_INFERENCE_BATCH_SIZE <= MAX_RERANK_DOCUMENTS:
    raise RuntimeError("LOCAL_RERANK_INFERENCE_BATCH_SIZE is outside the allowed request batch.")


class EmbeddingRequest(BaseModel):
    input: str | list[str]
    input_type: Literal["query", "document"] = "document"

    @field_validator("input")
    @classmethod
    def validate_input(cls, value: str | list[str]) -> str | list[str]:
        values = [value] if isinstance(value, str) else value
        if not values or len(values) > MAX_EMBEDDING_INPUTS:
            raise ValueError(f"input must contain between 1 and {MAX_EMBEDDING_INPUTS} texts")
        if any(not item.strip() or len(item) > MAX_TEXT_CHARS for item in values):
            raise ValueError(f"each input must contain between 1 and {MAX_TEXT_CHARS} characters")
        return value


class RerankRequest(BaseModel):
    query: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    documents: list[str]
    top_n: int | None = Field(default=None, ge=1, le=MAX_RERANK_DOCUMENTS)
    instruction: str = Field(
        default="Determine whether multilingual e-commerce evidence matches the requested target product across languages and requested market metrics.",
        min_length=1,
        max_length=500,
    )

    @field_validator("documents")
    @classmethod
    def validate_documents(cls, value: list[str]) -> list[str]:
        if not value or len(value) > MAX_RERANK_DOCUMENTS:
            raise ValueError(f"documents must contain between 1 and {MAX_RERANK_DOCUMENTS} texts")
        if any(not item.strip() or len(item) > MAX_TEXT_CHARS for item in value):
            raise ValueError(f"each document must contain between 1 and {MAX_TEXT_CHARS} characters")
        return value


class ModelRuntime:
    def __init__(self) -> None:
        self._embedding_model = None
        self._reranker_model = None
        self._inference_lock = threading.Lock()
        self.device = self._resolve_device()

    @staticmethod
    def _resolve_device() -> str:
        if FAKE_MODE:
            return "fake"
        if torch.backends.mps.is_available():
            return "mps"
        if ALLOW_CPU:
            return "cpu"
        raise RuntimeError("Apple Metal/MPS is unavailable and LOCAL_MODEL_ALLOW_CPU is false.")

    @property
    def embedding_loaded(self) -> bool:
        return self._embedding_model is not None

    @property
    def reranker_loaded(self) -> bool:
        return self._reranker_model is not None

    def embed(self, texts: list[str], input_type: Literal["query", "document"]) -> list[list[float]]:
        if FAKE_MODE:
            return [_fake_embedding(text, EMBEDDING_DIMENSIONS) for text in texts]
        with self._inference_lock:
            model = self._load_embedding_model()
            encoded = model.encode(
                texts,
                batch_size=EMBEDDING_INFERENCE_BATCH_SIZE,
                prompt_name="query" if input_type == "query" else None,
                normalize_embeddings=True,
                truncate_dim=EMBEDDING_DIMENSIONS,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
        matrix = np.asarray(encoded, dtype=np.float32)
        if matrix.ndim == 1:
            matrix = matrix.reshape(1, -1)
        if matrix.shape[1] != EMBEDDING_DIMENSIONS:
            raise RuntimeError(
                f"Embedding model returned {matrix.shape[1]} dimensions; expected {EMBEDDING_DIMENSIONS}."
            )
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        if np.any(~np.isfinite(matrix)) or np.any(norms == 0):
            raise RuntimeError("Embedding model returned non-finite or zero vectors.")
        matrix = matrix / norms
        return matrix.tolist()

    def rerank(self, query: str, documents: list[str], instruction: str) -> list[float]:
        if FAKE_MODE:
            return [_fake_relevance(query, document) for document in documents]
        with self._inference_lock:
            model = self._load_reranker_model(instruction)
            pairs = [(query, document) for document in documents]
            values = model.predict(
                pairs,
                batch_size=RERANK_INFERENCE_BATCH_SIZE,
                activation_fn=torch.nn.Sigmoid(),
                show_progress_bar=False,
            )
        scores = np.asarray(values, dtype=np.float32).reshape(-1)
        if scores.shape[0] != len(documents) or np.any(~np.isfinite(scores)):
            raise RuntimeError("Reranker returned an invalid score vector.")
        return [float(min(1.0, max(0.0, score))) for score in scores]

    def _load_embedding_model(self):
        if self._embedding_model is None:
            from sentence_transformers import SentenceTransformer

            self._embedding_model = SentenceTransformer(
                EMBEDDING_MODEL,
                device=self.device,
                truncate_dim=EMBEDDING_DIMENSIONS,
                model_kwargs={"torch_dtype": torch.float16} if self.device == "mps" else {},
            )
        return self._embedding_model

    def _load_reranker_model(self, instruction: str):
        if self._reranker_model is None:
            from sentence_transformers import CrossEncoder

            self._reranker_model = CrossEncoder(
                RERANKER_MODEL,
                device=self.device,
                max_length=4096,
                prompts={"commerce": instruction},
                default_prompt_name="commerce",
                model_kwargs={"torch_dtype": torch.float16} if self.device == "mps" else {},
            )
        return self._reranker_model


runtime = ModelRuntime()
app = FastAPI(title="SHUEHO Local Retrieval Models", version="0.1.0")


def authorize(authorization: str | None = Header(default=None)) -> None:
    if authorization is None or not hmac.compare_digest(authorization, f"Bearer {MODEL_TOKEN}"):
        raise HTTPException(status_code=401, detail="Unauthorized local model request.")


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "service": "shueho-local-retrieval-models",
        "device": runtime.device,
        "fake": FAKE_MODE,
        "embedding": {
            "model": EMBEDDING_MODEL_DISPLAY,
            "revision": EMBEDDING_MODEL_REVISION,
            "dimensions": EMBEDDING_DIMENSIONS,
            "loaded": runtime.embedding_loaded,
        },
        "reranker": {
            "model": RERANKER_MODEL_DISPLAY,
            "revision": RERANKER_MODEL_REVISION,
            "loaded": runtime.reranker_loaded,
        },
    }


@app.post("/v1/embeddings", dependencies=[Depends(authorize)])
def embeddings(request: EmbeddingRequest) -> dict[str, object]:
    texts = [request.input] if isinstance(request.input, str) else request.input
    vectors = runtime.embed(texts, request.input_type)
    return {
        "object": "list",
        "model": EMBEDDING_MODEL_DISPLAY,
        "revision": EMBEDDING_MODEL_REVISION,
        "dimensions": EMBEDDING_DIMENSIONS,
        "data": [
            {"object": "embedding", "index": index, "embedding": vector}
            for index, vector in enumerate(vectors)
        ],
    }


@app.post("/v1/rerank", dependencies=[Depends(authorize)])
def rerank(request: RerankRequest) -> dict[str, object]:
    scores = runtime.rerank(request.query, request.documents, request.instruction)
    ranked = sorted(
        (
            {"index": index, "relevance_score": score}
            for index, score in enumerate(scores)
        ),
        key=lambda item: (-item["relevance_score"], item["index"]),
    )
    if request.top_n is not None:
        ranked = ranked[: request.top_n]
    return {"model": RERANKER_MODEL_DISPLAY, "revision": RERANKER_MODEL_REVISION, "results": ranked}


def _fake_embedding(text: str, dimensions: int) -> list[float]:
    values: list[float] = []
    counter = 0
    while len(values) < dimensions:
        digest = hashlib.sha256(f"{counter}:{text}".encode("utf-8")).digest()
        values.extend((byte - 127.5) / 127.5 for byte in digest)
        counter += 1
    vector = np.asarray(values[:dimensions], dtype=np.float32)
    vector /= np.linalg.norm(vector)
    return vector.tolist()


def _fake_relevance(query: str, document: str) -> float:
    query_tokens = _semantic_tokens(query)
    document_tokens = _semantic_tokens(document)
    if not query_tokens or not document_tokens:
        return 0.0
    intersection = len(query_tokens & document_tokens)
    union = len(query_tokens | document_tokens)
    jaccard = intersection / union if union else 0.0
    contains = any(token in document for token in query_tokens if len(token) >= 2)
    return min(0.99, 0.15 + jaccard * 2.5 + (0.45 if contains else 0.0))


def _semantic_tokens(value: str) -> set[str]:
    normalized = "".join(character.lower() if character.isalnum() else " " for character in value)
    words = {word for word in normalized.split() if word}
    chinese = "".join(character for character in value if "\u4e00" <= character <= "\u9fff")
    words.update(chinese[index : index + 2] for index in range(max(0, len(chinese) - 1)))
    return words
