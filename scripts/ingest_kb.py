"""Ingest knowledge_base/*.md into the vector store (Chroma if keyed, else
in-memory). With real embeddings this persists to backend/data/chroma.

    make ingest   # or: PYTHONPATH=backend python scripts/ingest_kb.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.config import settings  # noqa: E402
from app.rag.ingest import ingest_knowledge_base  # noqa: E402
from app.rag.store import get_vector_store  # noqa: E402


def main() -> None:
    count = ingest_knowledge_base()
    store = get_vector_store()
    backend = getattr(store, "name", "?")
    mode = "Chroma (persistent)" if settings.use_real_embeddings else "in-memory (mock)"
    print(f"✓ Indexed {count} chunks into the {mode} vector store [{backend}].")
    if not settings.use_real_embeddings:
        print("  (In-memory store is per-process; the backend re-ingests on startup.)")


if __name__ == "__main__":
    main()
