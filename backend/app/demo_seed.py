"""Demo seeding — a realistic "busy week at a solar farm".

`seed_demo_data()` backfills the in-memory store with ~20 work orders spread
across the last two weeks (varied assets, sites, workers, severities, statuses),
matching escalation alerts for the critical/high faults, and an activity feed —
so the dashboards have real numbers the moment the app boots.

Two guards keep it safe:
  * idempotent — does nothing if the store already holds work orders
  * env-gated — skipped entirely when DEMO_SEED == "0" (e.g. in tests)
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from .db import get_store


def _ts(days_ago: float, hour: int = 9, minute: int = 0) -> str:
    """A backdated UTC ISO8601 timestamp `days_ago` days before now."""
    base = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return base.replace(hour=hour, minute=minute, second=0, microsecond=0).isoformat()


# Each entry: a fully-specified work order plus when it happened. `days_ago` is
# spread across the last ~14 days; today (0) gets a couple so "logged_today" > 0.
_SEED: list[dict] = [
    # --- today ---
    {"days_ago": 0, "hour": 8, "worker_id": "tech-arjun", "asset_id": "INV-07",
     "site_id": "SITE-Bengaluru-3", "severity": "high", "status": "open",
     "inspection_result": "fail", "fault_code": "INV-LOWOUT",
     "location": "string 2", "confidence": 0.91,
     "action_taken": "Isolated string 2 pending IV-curve trace.",
     "parts_required": ["MC4-connector"],
     "transcript": "inverter seven string two low output, severity high, isolated the string"},
    {"days_ago": 0, "hour": 11, "worker_id": "tech-meena", "asset_id": "CB-B",
     "site_id": "SITE-Pune-1", "severity": "medium", "status": "in_progress",
     "inspection_result": "partial", "fault_code": "CB-FUSE",
     "location": "input 5", "confidence": 0.84,
     "action_taken": "Found blown 15A fuse on input 5; replacement ordered.",
     "parts_required": ["string-fuse-15A"],
     "transcript": "combiner box B blown fuse on input five, severity medium"},

    # --- 1-3 days ago ---
    {"days_ago": 1, "hour": 14, "worker_id": "tech-ravi", "asset_id": "INV-12",
     "site_id": "SITE-Bengaluru-3", "severity": "critical", "status": "in_progress",
     "inspection_result": "fail", "fault_code": "INV-OVERTEMP",
     "location": "cabinet", "confidence": 0.96,
     "action_taken": "Smoke and sparking reported; shut down inverter, escalated.",
     "parts_required": ["cooling-fan", "IGBT-module"],
     "transcript": "emergency, smoke and sparking from inverter twelve"},
    {"days_ago": 1, "hour": 10, "worker_id": "tech-sana", "asset_id": "TX-01",
     "site_id": "SITE-Jaipur-2", "severity": "medium", "status": "open",
     "inspection_result": "partial", "fault_code": "TX-OILTEMP",
     "location": "transformer yard", "confidence": 0.79,
     "action_taken": "Oil temperature running high; scheduled cooling check.",
     "parts_required": [],
     "transcript": "transformer one oil temperature high, severity medium"},
    {"days_ago": 2, "hour": 9, "worker_id": "tech-arjun", "asset_id": "INV-08",
     "site_id": "SITE-Bengaluru-3", "severity": "low", "status": "closed",
     "inspection_result": "pass", "fault_code": "INV-OFFLINE",
     "location": "comms card", "confidence": 0.88,
     "action_taken": "Reset communications card; comms restored.",
     "parts_required": [],
     "transcript": "inverter eight was offline, reset the comms card, severity low"},
    {"days_ago": 2, "hour": 16, "worker_id": "tech-meena", "asset_id": "INV-03",
     "site_id": "SITE-Pune-1", "severity": "high", "status": "open",
     "inspection_result": "fail", "fault_code": "INV-GNDFLT",
     "location": "string 3", "confidence": 0.92,
     "action_taken": "Ground fault detected on string 3; insulation test pending.",
     "parts_required": ["insulation-tester"],
     "transcript": "inverter three ground fault on string three, severity high"},
    {"days_ago": 3, "hour": 13, "worker_id": "tech-ravi", "asset_id": "CB-B",
     "site_id": "SITE-Jaipur-2", "severity": "low", "status": "closed",
     "inspection_result": "pass", "fault_code": "CB-FUSE",
     "location": "input 2", "confidence": 0.81,
     "action_taken": "Replaced blown string fuse; combiner back online.",
     "parts_required": ["string-fuse-15A"],
     "transcript": "combiner box B input two fuse replaced, severity low"},

    # --- 4-7 days ago ---
    {"days_ago": 4, "hour": 11, "worker_id": "tech-sana", "asset_id": "INV-07",
     "site_id": "SITE-Bengaluru-3", "severity": "medium", "status": "closed",
     "inspection_result": "pass", "fault_code": "INV-OVERTEMP",
     "location": "cooling fan", "confidence": 0.87,
     "action_taken": "Cleaned cooling fan and recalibrated MPPT; temps normal.",
     "parts_required": ["cooling-fan"],
     "transcript": "inverter seven overheating, cleaned the fan, severity medium"},
    {"days_ago": 4, "hour": 15, "worker_id": "tech-arjun", "asset_id": "INV-12",
     "site_id": "SITE-Bengaluru-3", "severity": "high", "status": "in_progress",
     "inspection_result": "fail", "fault_code": "INV-LOWOUT",
     "location": "string 4", "confidence": 0.9,
     "action_taken": "Low output on string 4; IV-curve trace scheduled.",
     "parts_required": ["MC4-connector"],
     "transcript": "inverter twelve string four low output, severity high"},
    {"days_ago": 5, "hour": 10, "worker_id": "tech-meena", "asset_id": "INV-08",
     "site_id": "SITE-Pune-1", "severity": "low", "status": "closed",
     "inspection_result": "pass", "fault_code": None,
     "location": "routine", "confidence": 0.76,
     "action_taken": "Routine inspection, no faults found.",
     "parts_required": [],
     "transcript": "inverter eight routine check, all good, severity low"},
    {"days_ago": 5, "hour": 14, "worker_id": "tech-ravi", "asset_id": "TX-01",
     "site_id": "SITE-Jaipur-2", "severity": "critical", "status": "closed",
     "inspection_result": "fail", "fault_code": "TX-OILTEMP",
     "location": "transformer yard", "confidence": 0.94,
     "action_taken": "Critical oil temp; topped up coolant and cleared blockage.",
     "parts_required": ["coolant"],
     "transcript": "transformer one critical oil temperature, severity critical"},
    {"days_ago": 6, "hour": 9, "worker_id": "tech-sana", "asset_id": "INV-03",
     "site_id": "SITE-Pune-1", "severity": "medium", "status": "open",
     "inspection_result": "partial", "fault_code": "STR-OPEN",
     "location": "string 1", "confidence": 0.83,
     "action_taken": "Open string detected; reconnection pending.",
     "parts_required": ["string-fuse-15A"],
     "transcript": "inverter three open string on string one, severity medium"},
    {"days_ago": 6, "hour": 12, "worker_id": "tech-arjun", "asset_id": "CB-B",
     "site_id": "SITE-Bengaluru-3", "severity": "low", "status": "closed",
     "inspection_result": "pass", "fault_code": None,
     "location": "enclosure", "confidence": 0.78,
     "action_taken": "Cleaned enclosure and checked torque on terminals.",
     "parts_required": [],
     "transcript": "combiner box B routine maintenance, severity low"},
    {"days_ago": 7, "hour": 11, "worker_id": "tech-meena", "asset_id": "INV-07",
     "site_id": "SITE-Bengaluru-3", "severity": "high", "status": "closed",
     "inspection_result": "fail", "fault_code": "INV-LOWOUT",
     "location": "string 2", "confidence": 0.93,
     "action_taken": "Replaced MC4 connector on string 2; output restored.",
     "parts_required": ["MC4-connector"],
     "transcript": "inverter seven string two low output fixed, severity high"},

    # --- 8-13 days ago ---
    {"days_ago": 8, "hour": 13, "worker_id": "tech-ravi", "asset_id": "INV-12",
     "site_id": "SITE-Bengaluru-3", "severity": "medium", "status": "closed",
     "inspection_result": "pass", "fault_code": "INV-OVERTEMP",
     "location": "cooling system", "confidence": 0.85,
     "action_taken": "Thermal scan clear after fan service.",
     "parts_required": ["cooling-fan"],
     "transcript": "inverter twelve overheating resolved, severity medium"},
    {"days_ago": 9, "hour": 10, "worker_id": "tech-sana", "asset_id": "INV-08",
     "site_id": "SITE-Pune-1", "severity": "high", "status": "in_progress",
     "inspection_result": "fail", "fault_code": "INV-OFFLINE",
     "location": "comms card", "confidence": 0.89,
     "action_taken": "Repeated comms dropouts; awaiting replacement card.",
     "parts_required": ["comms-card"],
     "transcript": "inverter eight keeps going offline, severity high"},
    {"days_ago": 10, "hour": 15, "worker_id": "tech-arjun", "asset_id": "TX-01",
     "site_id": "SITE-Jaipur-2", "severity": "low", "status": "closed",
     "inspection_result": "pass", "fault_code": None,
     "location": "transformer yard", "confidence": 0.8,
     "action_taken": "Routine oil level check, within range.",
     "parts_required": [],
     "transcript": "transformer one oil level check, all good, severity low"},
    {"days_ago": 11, "hour": 9, "worker_id": "tech-meena", "asset_id": "INV-03",
     "site_id": "SITE-Pune-1", "severity": "critical", "status": "closed",
     "inspection_result": "fail", "fault_code": "INV-GNDFLT",
     "location": "string 3", "confidence": 0.97,
     "action_taken": "Severe ground fault; isolated array, replaced cabling.",
     "parts_required": ["dc-cable", "insulation-tester"],
     "transcript": "inverter three critical ground fault, severity critical"},
    {"days_ago": 12, "hour": 14, "worker_id": "tech-ravi", "asset_id": "INV-07",
     "site_id": "SITE-Bengaluru-3", "severity": "medium", "status": "closed",
     "inspection_result": "partial", "fault_code": "STR-OPEN",
     "location": "string 1", "confidence": 0.82,
     "action_taken": "Reconnected open string after connector reseat.",
     "parts_required": ["MC4-connector"],
     "transcript": "inverter seven open string reconnected, severity medium"},
    {"days_ago": 13, "hour": 11, "worker_id": "tech-sana", "asset_id": "CB-B",
     "site_id": "SITE-Jaipur-2", "severity": "low", "status": "closed",
     "inspection_result": "pass", "fault_code": "CB-FUSE",
     "location": "input 7", "confidence": 0.77,
     "action_taken": "Swapped string fuse on input 7; verified output.",
     "parts_required": ["string-fuse-15A"],
     "transcript": "combiner box B input seven fuse swapped, severity low"},
    {"days_ago": 13, "hour": 16, "worker_id": "tech-arjun", "asset_id": "INV-12",
     "site_id": "SITE-Bengaluru-3", "severity": "high", "status": "closed",
     "inspection_result": "fail", "fault_code": "INV-LOWOUT",
     "location": "string 3", "confidence": 0.9,
     "action_taken": "Replaced connector on string 3; output recovered.",
     "parts_required": ["MC4-connector"],
     "transcript": "inverter twelve string three low output, severity high"},
]

_KIND_BY_RESULT = {
    "fail": "inspection",
    "partial": "inspection",
    "pass": "inspection",
}

# Field crew — the dashboard worker roster is derived from who logs work orders.
WORKERS = ["krritin", "navjeet", "shlok", "krishaank", "yuvraj"]


def seed_demo_data() -> int:
    """Seed the store with the demo dataset. Returns the number of WOs created.

    No-op (returns 0) if DEMO_SEED == "0" or the store already has work orders.
    """
    from .config import settings
    if not settings.demo_seed:
        return 0

    store = get_store()
    if store.list():  # idempotent: don't double-seed
        return 0

    created = 0
    for idx, spec in enumerate(_SEED):
        worker_id = WORKERS[idx % len(WORKERS)]
        created_at = _ts(spec["days_ago"], spec.get("hour", 9), spec.get("minute", 0))
        wo = store.create({
            "worker_id": worker_id,
            "asset_id": spec["asset_id"],
            "site_id": spec["site_id"],
            "inspection_result": spec.get("inspection_result"),
            "fault_code": spec.get("fault_code"),
            "location": spec.get("location"),
            "severity": spec["severity"],
            "action_taken": spec.get("action_taken"),
            "parts_required": spec.get("parts_required", []),
            "status": spec["status"],
            "source_transcript": spec.get("transcript"),
            "confidence": spec["confidence"],
            "created_at": created_at,
        })
        created += 1

        # Escalation alert for the serious faults.
        if spec["severity"] in ("high", "critical"):
            store.add_alert({
                "work_order_id": wo["work_order_id"],
                "asset_id": wo["asset_id"],
                "severity": spec["severity"],
                "message": (
                    f"{spec['severity'].upper()} fault on {wo['asset_id']} "
                    f"({spec.get('fault_code') or 'unspecified'}) at "
                    f"{wo['site_id']} — {spec.get('action_taken', '')}".strip()
                ),
                "created_at": created_at,
            })
            store.add_activity({
                "worker_id": worker_id,
                "kind": "escalation",
                "summary": (
                    f"Escalated {spec['severity']} fault on {wo['asset_id']} "
                    f"at {wo['site_id']}"
                ),
                "transcript": spec.get("transcript"),
                "created_at": created_at,
            })

        # Activity event for every logged inspection.
        store.add_activity({
            "worker_id": worker_id,
            "kind": _KIND_BY_RESULT.get(spec.get("inspection_result"), "inspection"),
            "summary": (
                f"Logged {wo['work_order_id']} on {wo['asset_id']} "
                f"({spec['severity']}, {spec['status']})"
            ),
            "transcript": spec.get("transcript"),
            "created_at": created_at,
        })

    return created
