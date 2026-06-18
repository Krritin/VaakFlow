"""Seed the Neo4j Aura knowledge graph from the canonical seed data.

Runs against Neo4j only when NEO4J_URI / NEO4J_PASSWORD are set; otherwise it
explains that the in-memory MockGraph is already seeded with the same data, so
the demo works with no graph database.

    make seed   # or: PYTHONPATH=backend python scripts/seed_neo4j.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.config import settings  # noqa: E402
from app.graphdb.neo4j_client import (  # noqa: E402
    ASSETS,
    FAULT_HISTORY,
    FAULT_TO_PROCEDURE,
    SITE,
    ensure_tls_certs,
)


def seed_real() -> None:
    from neo4j import GraphDatabase

    ensure_tls_certs()  # use certifi's CA bundle for the Bolt+TLS handshake
    driver = GraphDatabase.driver(
        settings.neo4j_uri, auth=(settings.neo4j_username, settings.neo4j_password)
    )
    with driver.session() as s:
        s.run("MERGE (:Site {id: $id})", id=SITE)
        for asset_id, spec in ASSETS.items():
            s.run(
                "MERGE (a:Asset {id: $id}) SET a += $props "
                "WITH a MATCH (site:Site {id: $site}) MERGE (site)-[:HAS_ASSET]->(a)",
                id=asset_id, props=spec, site=SITE,
            )
        for asset_id, events in FAULT_HISTORY.items():
            for ev in events:
                s.run(
                    "MATCH (a:Asset {id: $id}) "
                    "CREATE (f:FaultEvent {code: $code, date: $date}) "
                    "CREATE (a)-[:HAD_FAULT]->(f) "
                    "CREATE (act:Action {notes: $notes}) "
                    "CREATE (f)-[:RESOLVED_BY]->(act)",
                    id=asset_id, code=ev["code"], date=ev["date"],
                    notes=ev["resolved_by"],
                )
        for code, proc in FAULT_TO_PROCEDURE.items():
            s.run(
                "MERGE (fc:FaultCode {code: $code}) "
                "MERGE (p:Procedure {name: $proc}) MERGE (fc)-[:SUGGESTS]->(p)",
                code=code, proc=proc,
            )
    driver.close()
    print(f"✓ Seeded Neo4j at {settings.neo4j_uri}: "
          f"{len(ASSETS)} assets, {sum(len(v) for v in FAULT_HISTORY.values())} faults.")


def main() -> None:
    if settings.use_real_graph:
        seed_real()
    else:
        print("NEO4J_* not set — nothing to push.")
        print("The in-memory MockGraph is already seeded with the same data:")
        print(f"  site={SITE}  assets={list(ASSETS)}")
        print(f"  fault history for: {list(FAULT_HISTORY)}")
        print("Set NEO4J_URI / NEO4J_PASSWORD in backend/.env to seed Aura.")


if __name__ == "__main__":
    main()
