"""Short-term memory = the conversation thread for a worker session.

The LangGraph checkpointer persists state keyed by thread_id, so a worker can
say "close that one" and the previous turn's work-order id is still in state,
and an interrupted/offline flow resumes instead of restarting.
"""
from __future__ import annotations


def thread_id(worker_id: str, session_id: str) -> str:
    return f"{worker_id}:{session_id}"


def thread_config(worker_id: str, session_id: str) -> dict:
    """Config dict LangGraph uses to scope checkpointed state to this session."""
    return {"configurable": {"thread_id": thread_id(worker_id, session_id)}}
