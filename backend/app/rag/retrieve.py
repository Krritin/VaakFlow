"""Hybrid retrieval: vector chunks (Chroma/in-memory) + graph facts (Neo4j),
re-ranked, with a confidence score the graph uses for corrective RAG.
"""
from __future__ import annotations

from .. import vocabulary
from ..db import get_store
from ..graphdb import get_graph
from .rerank import rerank
from .store import get_vector_store


def _work_log_facts(asset_id: str) -> str:
    """Recent logged work orders for an asset — answers 'when/who last checked'."""
    rows = get_store().list(asset_id=asset_id)  # newest first
    if not rows:
        return ""
    lines: list[str] = []
    for i, w in enumerate(rows[:3]):
        when = (w.get("created_at") or "")[:10] or "an unknown date"
        worker = (w.get("worker_id") or "unknown").replace("tech-", "")
        worker = worker[:1].upper() + worker[1:]
        what = w.get("fault_code") or w.get("inspection_result") or "inspection"
        prefix = "last checked" if i == 0 else "also logged"
        lines.append(
            f"[work log] {asset_id} {prefix} by {worker} on {when} — {what}, "
            f"severity {w.get('severity') or 'n/a'}, status {w.get('status')}."
        )
    return "\n".join(lines)


def retrieve(query: str, source_text: str = "", k: int = 4) -> dict:
    store = get_vector_store()
    graph = get_graph()

    basis = source_text or query
    asset_id = vocabulary.extract_asset_id(basis)
    fault_code = vocabulary.match_fault_code(basis)

    vector_hits = store.query(query, k=k)
    ranked = rerank(query, vector_hits)
    top_chunks = ranked[:3]

    work_facts = _work_log_facts(asset_id) if asset_id else ""
    graph_facts = graph.facts_for(asset_id, fault_code)

    context_parts: list[str] = []
    if work_facts:  # most relevant for "when/who last checked"
        context_parts.append(work_facts)
    if graph_facts:
        context_parts.append(graph_facts)
    for c in top_chunks:
        src = c["meta"].get("source", "manual")
        context_parts.append(f"[{src}] {c['text']}")

    sources: list[str] = []
    if work_facts:
        sources.append("work order log")
    if graph_facts:
        sources.append("knowledge graph (Neo4j)")
    for c in top_chunks:
        s = c["meta"].get("source")
        if s and s not in sources:
            sources.append(s)

    top_score = top_chunks[0]["rerank_score"] if top_chunks else 0.0
    if graph_facts or work_facts:  # structured facts are high-trust
        top_score = max(top_score, 0.75)

    return {
        "context": "\n\n".join(context_parts),
        "sources": sources,
        "top_score": round(top_score, 4),
        "asset_id": asset_id,
        "fault_code": fault_code,
        "num_chunks": len(top_chunks),
    }
