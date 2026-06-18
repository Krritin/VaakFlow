"""Ingest the knowledge base (knowledge_base/*.md) into the vector store."""
from __future__ import annotations

from ..config import KNOWLEDGE_BASE_DIR
from .chunk import chunk_text
from .store import get_vector_store


def ingest_knowledge_base() -> int:
    """Chunk + embed every markdown doc. Returns number of chunks indexed."""
    store = get_vector_store()
    if store.count() > 0:  # idempotent for hot reloads
        return store.count()

    if not KNOWLEDGE_BASE_DIR.exists():
        return 0

    texts: list[str] = []
    metas: list[dict] = []
    for path in sorted(KNOWLEDGE_BASE_DIR.glob("*.md")):
        content = path.read_text(encoding="utf-8")
        for i, chunk in enumerate(chunk_text(content)):
            texts.append(chunk)
            metas.append({"source": path.stem, "chunk": i})

    if texts:
        store.add(texts, metas)
    return store.count()
