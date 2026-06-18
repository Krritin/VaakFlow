"""MCP tool server for work-order operations + equipment reads.

`tools.py` holds the tool implementations (called in-process by the LangGraph
agent today). `server.py` exposes the same functions over the MCP protocol via
FastMCP — run it standalone with `python -m app.mcp_server.server`.
"""
from . import tools

__all__ = ["tools"]
