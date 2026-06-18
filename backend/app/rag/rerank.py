"""Re-ranking. Real: bge-reranker-base cross-encoder. Mock: lexical overlap
blended with the retrieval score (good enough to reorder demo candidates).
"""
from __future__ import annotations

import re
from functools import lru_cache

from ..config import settings


def _tokens(text: str) -> set[str]:
    return {t for t in re.split(r"\W+", text.lower()) if len(t) > 2}


@lru_cache
def _cross_encoder():
    from sentence_transformers import CrossEncoder  # lazy

    return CrossEncoder("BAAI/bge-reranker-base")


def rerank(query: str, candidates: list[dict]) -> list[dict]:
    """Return candidates sorted by rerank score (descending), score added."""
    if not candidates:
        return []

    if not settings.force_mock:
        try:
            model = _cross_encoder()
            pairs = [(query, c["text"]) for c in candidates]
            scores = model.predict(pairs)
            for c, s in zip(candidates, scores):
                c["rerank_score"] = float(s)
            return sorted(candidates, key=lambda c: c["rerank_score"], reverse=True)
        except Exception:  # noqa: BLE001 — cross-encoder not installed -> mock
            pass

    q = _tokens(query)
    for c in candidates:
        overlap = len(q & _tokens(c["text"])) / (len(q) or 1)
        # blend lexical overlap with the upstream vector score
        c["rerank_score"] = round(0.6 * overlap + 0.4 * c.get("score", 0.0), 4)
    return sorted(candidates, key=lambda c: c["rerank_score"], reverse=True)
