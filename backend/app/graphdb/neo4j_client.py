"""Knowledge graph: Site -> Asset -> String/Panel, Procedures, Parts, Faults.

Multi-hop relationship queries (fault history, "what fixed it last time") are
what vectors are bad at and graphs are great at. MockGraph holds a small seeded
graph in memory so history/spec questions work offline; Neo4jGraph runs the same
queries against Aura when NEO4J_* is set. The seed mirrors scripts/seed_neo4j.py.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Protocol

from ..config import settings


def ensure_tls_certs() -> None:
    """Point stdlib SSL at certifi's CA bundle before opening a Bolt+TLS driver.

    On macOS / venv Pythons the stdlib SSL trust store is often empty, so the
    neo4j+s handshake fails with "Unable to retrieve routing information" even
    though the host:7687 is reachable. certifi ships the same roots httpx uses.
    setdefault() respects an explicit SSL_CERT_FILE override if one is set.
    """
    import os

    import certifi

    os.environ.setdefault("SSL_CERT_FILE", certifi.where())

# --------------------------------------------------------------------------- #
# Seed data (single source of truth, also used by scripts/seed_neo4j.py)
# --------------------------------------------------------------------------- #
SITE = "SITE-Bengaluru-3"

ASSETS: dict[str, dict] = {
    "INV-07": {"type": "inverter", "site": SITE, "rated_kw": 50,
               "strings": 4, "model": "SunPeak SP-50"},
    "INV-08": {"type": "inverter", "site": SITE, "rated_kw": 50,
               "strings": 4, "model": "SunPeak SP-50"},
    "INV-12": {"type": "inverter", "site": SITE, "rated_kw": 60,
               "strings": 5, "model": "SunPeak SP-60"},
    "CB-B": {"type": "combiner box", "site": SITE, "inputs": 8},
    "TX-01": {"type": "transformer", "site": SITE, "rated_kva": 630},
}

FAULT_HISTORY: dict[str, list[dict]] = {
    "INV-07": [
        {"code": "INV-LOWOUT", "date": "2026-03-12",
         "resolved_by": "Replaced MC4 connector on string 2; output restored.",
         "parts": ["MC4-connector"]},
        {"code": "INV-OVERTEMP", "date": "2025-11-02",
         "resolved_by": "Cleaned cooling fan and recalibrated MPPT.",
         "parts": ["cooling-fan"]},
    ],
    "INV-08": [
        {"code": "INV-OFFLINE", "date": "2026-01-20",
         "resolved_by": "Reset communications card; comms restored.",
         "parts": []},
    ],
    "CB-B": [
        {"code": "CB-FUSE", "date": "2026-02-10",
         "resolved_by": "Replaced blown 15A string fuse.",
         "parts": ["string-fuse-15A"]},
    ],
}

FAULT_TO_PROCEDURE: dict[str, str] = {
    "INV-LOWOUT": "IV-curve trace",
    "INV-OVERTEMP": "thermal imaging scan",
    "INV-OFFLINE": "communications reset procedure",
    "INV-GNDFLT": "insulation resistance test",
    "STR-OPEN": "string reconnection",
    "CB-FUSE": "combiner fuse replacement",
    "TX-OILTEMP": "transformer cooling check",
}


class Graph(Protocol):
    def validate_asset(self, asset_id: str | None) -> bool: ...
    def get_spec(self, asset_id: str) -> dict | None: ...
    def get_history(self, asset_id: str) -> list[dict]: ...
    def suggest_fix(self, fault_code: str) -> dict | None: ...
    def facts_for(self, asset_id: str | None, fault_code: str | None) -> str: ...


class MockGraph:
    name = "mock"

    def validate_asset(self, asset_id: str | None) -> bool:
        return bool(asset_id) and asset_id.upper() in ASSETS

    def get_spec(self, asset_id: str) -> dict | None:
        return ASSETS.get(asset_id.upper()) if asset_id else None

    def get_history(self, asset_id: str) -> list[dict]:
        return FAULT_HISTORY.get(asset_id.upper(), []) if asset_id else []

    def suggest_fix(self, fault_code: str) -> dict | None:
        if not fault_code:
            return None
        proc = FAULT_TO_PROCEDURE.get(fault_code)
        # find the most recent past resolution of this fault on any asset
        past = None
        for events in FAULT_HISTORY.values():
            for ev in events:
                if ev["code"] == fault_code:
                    if past is None or ev["date"] > past["date"]:
                        past = ev
        return {"procedure": proc, "last_resolution": past}

    def facts_for(self, asset_id: str | None, fault_code: str | None) -> str:
        """Render graph facts as sentences for the answer context."""
        lines: list[str] = []
        if asset_id and self.validate_asset(asset_id):
            spec = self.get_spec(asset_id)
            spec_bits = ", ".join(f"{k}={v}" for k, v in spec.items())
            lines.append(f"[graph] {asset_id} is a {spec.get('type')} ({spec_bits}).")
            history = self.get_history(asset_id)
            if history:
                hist = "; ".join(
                    f"{e['date']} {e['code']} -> {e['resolved_by']}" for e in history
                )
                lines.append(f"[graph] {asset_id} fault history: {hist}")
        if fault_code:
            fix = self.suggest_fix(fault_code)
            if fix and fix.get("procedure"):
                lines.append(
                    f"[graph] {fault_code} is usually handled by "
                    f"'{fix['procedure']}'."
                )
            if fix and fix.get("last_resolution"):
                lr = fix["last_resolution"]
                lines.append(f"[graph] Last time {fault_code} was fixed by: "
                             f"{lr['resolved_by']}")
        return "\n".join(lines)


class Neo4jGraph(MockGraph):
    """Real Aura-backed graph. Inherits mock rendering (facts_for); overrides the
    lookups with Cypher against the shape created by scripts/seed_neo4j.py:

        (:Site {id})-[:HAS_ASSET]->(:Asset {id, ...props})
        (:Asset)-[:HAD_FAULT]->(:FaultEvent {code, date})-[:RESOLVED_BY]->(:Action {notes})
        (:FaultCode {code})-[:SUGGESTS]->(:Procedure {name})

    Every lookup falls back to the inherited seeded data on any query error so
    the demo never breaks if Aura is unreachable or empty.
    """

    name = "neo4j"

    def __init__(self) -> None:
        ensure_tls_certs()
        from neo4j import GraphDatabase  # lazy

        self._driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_username, settings.neo4j_password),
        )

    def validate_asset(self, asset_id: str | None) -> bool:
        if not asset_id:
            return False
        try:
            with self._driver.session() as s:
                rec = s.run(
                    "MATCH (a:Asset {id: $id}) RETURN count(a) AS n",
                    id=asset_id.upper(),
                ).single()
                return bool(rec and rec["n"] > 0)
        except Exception:  # noqa: BLE001 — fall back to seeded data
            return super().validate_asset(asset_id)

    def get_spec(self, asset_id: str) -> dict | None:
        if not asset_id:
            return None
        try:
            with self._driver.session() as s:
                rec = s.run(
                    "MATCH (a:Asset {id: $id}) RETURN properties(a) AS props",
                    id=asset_id.upper(),
                ).single()
                if not rec:
                    return None
                spec = dict(rec["props"])
                spec.pop("id", None)  # mirror the seed-data shape (no id key)
                return spec
        except Exception:  # noqa: BLE001
            return super().get_spec(asset_id)

    def get_history(self, asset_id: str) -> list[dict]:
        if not asset_id:
            return []
        try:
            with self._driver.session() as s:
                result = s.run(
                    "MATCH (a:Asset {id: $id})-[:HAD_FAULT]->(f:FaultEvent)"
                    "-[:RESOLVED_BY]->(act:Action) "
                    "RETURN f.code AS code, f.date AS date, "
                    "act.notes AS resolved_by, "
                    "coalesce(act.parts, []) AS parts "
                    "ORDER BY f.date DESC",
                    id=asset_id.upper(),
                )
                return [
                    {
                        "code": r["code"],
                        "date": r["date"],
                        "resolved_by": r["resolved_by"],
                        "parts": list(r["parts"]),
                    }
                    for r in result
                ]
        except Exception:  # noqa: BLE001
            return super().get_history(asset_id)

    def suggest_fix(self, fault_code: str) -> dict | None:
        if not fault_code:
            return None
        try:
            with self._driver.session() as s:
                proc_rec = s.run(
                    "MATCH (fc:FaultCode {code: $code})-[:SUGGESTS]->(p:Procedure) "
                    "RETURN p.name AS procedure",
                    code=fault_code,
                ).single()
                procedure = proc_rec["procedure"] if proc_rec else None

                last_rec = s.run(
                    "MATCH (f:FaultEvent {code: $code})-[:RESOLVED_BY]->(act:Action) "
                    "RETURN f.code AS code, f.date AS date, "
                    "act.notes AS resolved_by, "
                    "coalesce(act.parts, []) AS parts "
                    "ORDER BY f.date DESC LIMIT 1",
                    code=fault_code,
                ).single()
                last_resolution = (
                    {
                        "code": last_rec["code"],
                        "date": last_rec["date"],
                        "resolved_by": last_rec["resolved_by"],
                        "parts": list(last_rec["parts"]),
                    }
                    if last_rec
                    else None
                )
                return {"procedure": procedure, "last_resolution": last_resolution}
        except Exception:  # noqa: BLE001
            return super().suggest_fix(fault_code)


@lru_cache
def get_graph() -> Graph:
    if settings.use_real_graph:
        try:
            return Neo4jGraph()
        except Exception:  # noqa: BLE001
            pass
    return MockGraph()
