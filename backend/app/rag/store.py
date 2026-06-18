"""Vector store. Mock: in-memory cosine search. Real: Chroma (persistent)."""
from __future__ import annotations

from functools import lru_cache
from typing import Protocol

from ..config import settings
from .embed import cosine, embed


class VectorStore(Protocol):
    def add(self, texts: list[str], metadatas: list[dict]) -> None: ...
    def query(self, text: str, k: int = 4) -> list[dict]: ...
    def count(self) -> int: ...


class InMemoryVectorStore:
    name = "memory"

    def __init__(self) -> None:
        self._docs: list[dict] = []  # {text, meta, vec}

    def add(self, texts: list[str], metadatas: list[dict]) -> None:
        vecs = embed(texts)
        for text, meta, vec in zip(texts, metadatas, vecs):
            self._docs.append({"text": text, "meta": meta, "vec": vec})

    def query(self, text: str, k: int = 4) -> list[dict]:
        if not self._docs:
            return []
        qv = embed([text])[0]
        scored = [
            {"text": d["text"], "meta": d["meta"], "score": cosine(qv, d["vec"])}
            for d in self._docs
        ]
        scored.sort(key=lambda d: d["score"], reverse=True)
        return scored[:k]

    def count(self) -> int:
        return len(self._docs)


class ChromaStore:
    """Persistent Chroma store using our embeddings (mock or Gemini)."""
    name = "chroma"

    def __init__(self) -> None:
        import chromadb  # lazy

        self._client = chromadb.PersistentClient(path=settings.chroma_dir)
        self._col = self._client.get_or_create_collection("vaakflow_kb")
        self._seq = self._col.count()

    def add(self, texts: list[str], metadatas: list[dict]) -> None:
        ids = [f"doc-{self._seq + i}" for i in range(len(texts))]
        self._seq += len(texts)
        self._col.add(ids=ids, documents=texts, metadatas=metadatas,
                      embeddings=embed(texts))

    def query(self, text: str, k: int = 4) -> list[dict]:
        res = self._col.query(query_embeddings=embed([text]), n_results=k)
        out: list[dict] = []
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        for doc, meta, dist in zip(docs, metas, dists):
            out.append({"text": doc, "meta": meta or {}, "score": 1.0 - float(dist)})
        return out

    def count(self) -> int:
        return self._col.count()


@lru_cache
def get_vector_store() -> VectorStore:
    # Use Chroma only when the real embedding stack is configured; otherwise the
    # zero-dependency in-memory store keeps mock mode light.
    if settings.use_real_embeddings:
        try:
            return ChromaStore()
        except Exception:  # noqa: BLE001
            pass
    return InMemoryVectorStore()
