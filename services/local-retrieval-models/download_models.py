from __future__ import annotations

import hashlib
import os
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

from huggingface_hub import snapshot_download


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MODEL_ROOT = REPOSITORY_ROOT / ".runtime" / "models"
MODELS = {
    "Qwen/Qwen3-Embedding-4B": {
        "revision": "5cf2132abc99cad020ac570b19d031efec650f2b",
        "target": MODEL_ROOT / "Qwen3-Embedding-4B",
        "weights": {
            "model-00001-of-00002.safetensors": (4965826464, "e70bfe3c970523fb7ef4eddffed2254ce3f1e7150c3de2af4342de129dd756f8"),
            "model-00002-of-00002.safetensors": (3077765624, "ed1b87c8e9eb7e535a1a155e4fd00d9f4dba80e58a6db48a4c9f82cede7079c1"),
        },
    },
    "Qwen/Qwen3-Reranker-4B": {
        "revision": "22e683669bc0f0bd69640a1354a6d0aebcfeede5",
        "target": MODEL_ROOT / "Qwen3-Reranker-4B",
        "weights": {
            "model-00001-of-00002.safetensors": (4058781760, "cf2e87cbf71fa628961532232e04dd6c19702a0a057f5e2aff95ea1aca4fd488"),
            "model-00002-of-00002.safetensors": (3984833200, "78946d22b7f6456ea7a5358dbdf3982de36c5bac1f166a5fd58e18e31db8048a"),
        },
    },
}


def verify_weight(path: Path, expected_size: int, expected_sha256: str) -> None:
    if path.stat().st_size != expected_size:
        raise RuntimeError(f"Weight size mismatch for {path.name}.")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_sha256:
        raise RuntimeError(f"Weight SHA-256 mismatch for {path.name}.")


for model_id, specification in MODELS.items():
    revision = specification["revision"]
    target = specification["target"]
    assert isinstance(revision, str)
    assert isinstance(target, Path)
    target.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=model_id,
        revision=revision,
        local_dir=target,
        max_workers=4,
    )
    for filename, (expected_size, expected_sha256) in specification["weights"].items():
        verify_weight(target / filename, expected_size, expected_sha256)
    print(f"Downloaded and verified {model_id}@{revision} at {target}")
