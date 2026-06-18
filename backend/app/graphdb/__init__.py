"""Knowledge graph (Neo4j Aura in prod, in-memory seeded graph in dev)."""
from .neo4j_client import get_graph

__all__ = ["get_graph"]
