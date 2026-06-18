"""Embeddings. Real providers (selected by settings.resolved_embeddings_provider):
- gemini: google.generativeai gemini-embedding-001.
- nim:    NVIDIA NIM OpenAI-compatible endpoint, nv-embedqa-e5-v5 (1024-d) via httpx.
Mock: deterministic hashed bag-of-words vectors (lexical similarity) so retrieval
works with no key. Any real-provider error falls back to the mock.
"""
from __future__ import annotations

import hashlib
import math
import re

from ..config import settings

_MOCK_DIM = 256


def _mock_embed_one(text: str) -> list[float]:
    vec = [0.0] * _MOCK_DIM
    for tok in re.split(r"\W+", text.lower()):
        if not tok:
            continue
        bucket = int(hashlib.md5(tok.encode()).hexdigest(), 16) % _MOCK_DIM
        vec[bucket] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _gemini_embed(texts: list[str]) -> list[list[float]]:
    import google.generativeai as genai  # lazy

    genai.configure(api_key=settings.gemini_key)
    out: list[list[float]] = []
    for t in texts:
        r = genai.embed_content(model=settings.gemini_embed_model, content=t)
        out.append(r["embedding"])
    return out


def _nim_embed(texts: list[str], input_type: str) -> list[list[float]]:
    import httpx  # lazy

    resp = httpx.post(
        f"{settings.nim_base_url.rstrip('/')}/embeddings",
        headers={"Authorization": f"Bearer {settings.nvidia_nim_api_key}"},
        json={
            "model": settings.nim_embed_model,
            "input": texts,
            "input_type": input_type,
            "truncate": "END",
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()["data"]
    return [item["embedding"] for item in data]


def embed(texts: list[str], input_type: str = "passage") -> list[list[float]]:
    """Embed texts. `input_type` ("passage" for ingest, "query" for search) is
    used by the NIM provider; ignored by gemini/mock. Backward-compatible: callers
    that omit it get "passage"."""
    provider = settings.resolved_embeddings_provider
    if provider != "mock":
        try:
            if provider == "gemini":
                return _gemini_embed(texts)
            if provider == "nim":
                return _nim_embed(texts, input_type)
        except Exception:  # noqa: BLE001 — fall back to deterministic mock
            pass
    return [_mock_embed_one(t) for t in texts]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)
