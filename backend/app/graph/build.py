"""Build + compile the LangGraph state machine and expose run_turn()."""
from __future__ import annotations

from functools import lru_cache

from langgraph.graph import END, START, StateGraph

from ..config import settings
from ..memory import thread_config
from . import nodes
from .state import GraphState


def _route_intent(state: GraphState) -> str:
    return {
        "LOG_INSPECTION": "extract",
        "QUERY": "rewrite",
        "WORK_ORDER_ACTION": "wo_action",
        "ESCALATE": "escalate",
        "UNCLEAR": "clarify",
    }.get(state.get("intent", "UNCLEAR"), "clarify")


MAX_CLARIFY = 3  # after this many ask-backs, persist best-effort (no infinite loop)


def _route_after_validate(state: GraphState) -> str:
    if state.get("missing_fields") and state.get("clarify_rounds", 0) < MAX_CLARIFY:
        return "clarify"
    return "persist"


def _make_checkpointer():
    """SqliteSaver for cross-restart resume; MemorySaver as a safe fallback."""
    try:
        import sqlite3

        from langgraph.checkpoint.sqlite import SqliteSaver

        conn = sqlite3.connect(settings.sqlite_checkpoint, check_same_thread=False)
        saver = SqliteSaver(conn)
        saver.setup()
        return saver
    except Exception:  # noqa: BLE001
        from langgraph.checkpoint.memory import MemorySaver

        return MemorySaver()


def _build() -> StateGraph:
    g = StateGraph(GraphState)

    g.add_node("router", nodes.node_router)
    g.add_node("extract", nodes.node_extract)
    g.add_node("validate", nodes.node_validate)
    g.add_node("persist", nodes.node_persist)
    g.add_node("clarify", nodes.node_clarify)
    g.add_node("wo_action", nodes.node_wo_action)
    g.add_node("escalate", nodes.node_escalate)
    g.add_node("rewrite", nodes.node_rewrite)
    g.add_node("retrieve", nodes.node_retrieve)
    g.add_node("answer", nodes.node_answer)
    g.add_node("confirm", nodes.node_confirm)
    g.add_node("memory", nodes.node_memory)

    g.add_edge(START, "router")
    g.add_conditional_edges("router", _route_intent, {
        "extract": "extract", "rewrite": "rewrite", "wo_action": "wo_action",
        "escalate": "escalate", "clarify": "clarify",
    })

    g.add_edge("extract", "validate")
    g.add_conditional_edges("validate", _route_after_validate, {
        "clarify": "clarify", "persist": "persist",
    })

    g.add_edge("rewrite", "retrieve")
    g.add_conditional_edges("retrieve", nodes.route_after_retrieve, {
        "rewrite": "rewrite", "answer": "answer",
    })

    for terminal in ("persist", "wo_action", "escalate", "clarify", "answer"):
        g.add_edge(terminal, "confirm")
    g.add_edge("confirm", "memory")
    g.add_edge("memory", END)
    return g


@lru_cache
def get_graph_app():
    return _build().compile(checkpointer=_make_checkpointer())


# Fields reset at the start of every turn (last-write-wins). Anything NOT here
# (e.g. last_work_order_id) persists across turns via the checkpointer.
_TURN_RESET: dict = {
    "intent": "", "work_order": None, "missing_fields": [], "rewritten_query": "",
    "context": "", "answer": "", "sources": [], "confidence": 0.0,
    "rag_retries": 0, "reply": "", "needs_clarification": False,
    "escalated": False, "trace": [],
}


def run_turn(
    transcript: str,
    *,
    worker_id: str = "tech-arjun",
    session_id: str = "default",
    site_id: str | None = "SITE-Bengaluru-3",
    language: str | None = None,
) -> GraphState:
    app = get_graph_app()
    inputs = {
        **_TURN_RESET,
        "transcript": transcript,
        "worker_id": worker_id,
        "session_id": session_id,
        "site_id": site_id,
        "language": language or "",
    }
    config = thread_config(worker_id, session_id)
    return app.invoke(inputs, config=config)
