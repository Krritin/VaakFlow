"""Shared graph state. Carried across turns by the checkpointer (per thread).

`trace` uses last-write-wins; nodes append to it manually and run_turn resets it
to [] at the start of each turn so it reflects the current turn's node path.
Carried fields like `last_work_order_id` persist across turns (that's the point).
"""
from __future__ import annotations

from typing import TypedDict


class GraphState(TypedDict, total=False):
    # --- turn inputs ---
    transcript: str
    worker_id: str
    session_id: str
    site_id: str | None
    language: str

    # --- routing / processing ---
    intent: str
    work_order: dict | None
    missing_fields: list[str]
    rewritten_query: str
    context: str
    answer: str
    sources: list[str]
    confidence: float
    rag_retries: int

    # --- outputs ---
    reply: str
    needs_clarification: bool
    escalated: bool

    # --- carried memory (persists across turns within a thread) ---
    last_work_order_id: str | None
    # slot-filling across clarify turns (also carried, NOT reset per turn)
    pending_wo: dict | None
    awaiting_field: str | None
    clarify_rounds: int
    convo: list[str]

    # --- per-turn trace (reset each turn) ---
    trace: list[str]
