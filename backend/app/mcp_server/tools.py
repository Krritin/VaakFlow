"""Work-order tool implementations (the MCP tool surface).

Each function is schema-validated and side-effecting against the store / graph.
The LangGraph agent invokes these as its tools; server.py re-exports them over
the MCP protocol so they are also callable by any MCP client.
"""
from __future__ import annotations

from ..db import get_store
from ..graphdb import get_graph
from ..schemas import WorkOrder


def create_work_order(payload: dict) -> dict:
    """Validate against the work-order schema and persist a new work order."""
    payload = dict(payload)
    # Real LLMs sometimes return parts_required as a string (or null) rather than
    # a list; coerce so schema validation never fails on type.
    pr = payload.get("parts_required")
    if isinstance(pr, str):
        payload["parts_required"] = [p.strip() for p in pr.split(",") if p.strip()]
    elif not isinstance(pr, list):
        payload["parts_required"] = []

    store = get_store()
    # One open work order per asset: a new log for an asset that still has an
    # OPEN work order replaces it. Closed ones are kept as history.
    asset = payload.get("asset_id")
    if asset:
        for existing in store.list(asset_id=asset, status="open"):
            store.delete(existing["work_order_id"])

    wo = WorkOrder(**payload).model_dump(mode="json")
    return store.create(wo)


def update_work_order(work_order_id: str, patch: dict) -> dict | None:
    """Apply a partial update to an existing work order."""
    return get_store().update(work_order_id, patch)


def close_work_order(work_order_id: str, notes: str | None = None) -> dict | None:
    """Close a work order, optionally appending resolution notes."""
    patch: dict = {"status": "closed"}
    if notes:
        patch["action_taken"] = notes
    return get_store().update(work_order_id, patch)


def get_equipment_spec(asset_id: str) -> dict | None:
    """Read an asset's spec from the knowledge graph."""
    return get_graph().get_spec(asset_id)


def get_maintenance_history(asset_id: str) -> list[dict]:
    """Read an asset's fault/resolution history from the knowledge graph."""
    return get_graph().get_history(asset_id)
