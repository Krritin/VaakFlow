"""FastMCP server exposing the work-order tools over the MCP protocol.

Run standalone:  python -m app.mcp_server.server
(`mcp` is part of requirements-full.txt — not needed for mock-mode dev.)
"""
from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from . import tools

mcp = FastMCP("vaakflow-work-orders")


@mcp.tool()
def create_work_order(payload: dict) -> dict:
    """Create a new solar work order from a schema-shaped payload."""
    return tools.create_work_order(payload)


@mcp.tool()
def update_work_order(work_order_id: str, patch: dict) -> dict | None:
    """Apply a partial update to an existing work order by id."""
    return tools.update_work_order(work_order_id, patch)


@mcp.tool()
def close_work_order(work_order_id: str, notes: str = "") -> dict | None:
    """Close a work order and optionally record resolution notes."""
    return tools.close_work_order(work_order_id, notes or None)


@mcp.tool()
def get_equipment_spec(asset_id: str) -> dict | None:
    """Return the spec for an asset (e.g. INV-07) from the knowledge graph."""
    return tools.get_equipment_spec(asset_id)


@mcp.tool()
def get_maintenance_history(asset_id: str) -> list[dict]:
    """Return the fault/resolution history for an asset from the graph."""
    return tools.get_maintenance_history(asset_id)


if __name__ == "__main__":
    mcp.run()
