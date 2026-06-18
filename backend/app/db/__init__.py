"""Work-order persistence (Supabase in prod, in-memory mock in dev)."""
from .store import get_store

__all__ = ["get_store"]
