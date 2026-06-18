"""VaakFlow success-metric evals (§16) — prints a pass/fail table.

Runs in deterministic MOCK mode so it works in CI with no keys. Exit code is the
number of failed metrics (0 = all green).

    make evals
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

os.environ.setdefault("FORCE_MOCK", "1")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.db import get_store  # noqa: E402
from app.graph import run_turn  # noqa: E402
from app.llm import get_llm  # noqa: E402
from app.schemas import REQUIRED_WO_FIELDS  # noqa: E402

Result = tuple[str, bool, str]


def m1_noisy_extraction() -> Result:
    noisy = "uh the inverter seven uh string two is not making any power i think"
    wo = get_llm().extract_work_order(noisy)
    ok = wo.get("asset_id") == "INV-07" and wo.get("fault_code") == "INV-LOWOUT"
    return ("Noisy-note extraction (STT proxy)", ok,
            f"asset={wo.get('asset_id')} fault={wo.get('fault_code')}")


def m2_all_fields() -> Result:
    final = run_turn(
        "inverter seven string two low output severity high, isolated the string",
        session_id="eval-extract",
    )
    wo = final.get("work_order") or {}
    missing = [f for f in REQUIRED_WO_FIELDS if not wo.get(f)]
    return ("Extraction maps all required fields", not missing,
            f"missing={missing or 'none'}")


def m3_query_latency() -> Result:
    t0 = time.perf_counter()
    run_turn("what faults has inverter seven had and how were they fixed?",
             session_id="eval-latency")
    ms = int((time.perf_counter() - t0) * 1000)
    return ("Query answer < 3s", ms < 3000, f"{ms} ms")


def m4_wo_creation_correct() -> Result:
    final = run_turn("combiner box B blown fuse severity medium",
                     session_id="eval-wo")
    wo = final.get("work_order") or {}
    wo_id = wo.get("work_order_id")
    stored = get_store().get(wo_id) if wo_id else None
    ok = bool(stored) and stored.get("asset_id") == "CB-B" \
        and stored.get("status") == "open" and stored.get("severity") == "medium"
    return ("Work-order creation correct (persisted)", ok,
            f"{wo_id} -> {stored.get('status') if stored else 'missing'}")


def m5_offline_sync() -> Result:
    notes = [
        "inverter seven low output severity high",
        "inverter eight offline severity medium",
        "combiner box B blown fuse severity low",
    ]
    created = 0
    for i, note in enumerate(notes):
        final = run_turn(note, session_id=f"eval-sync-{i}")
        if (final.get("work_order") or {}).get("work_order_id"):
            created += 1
    return ("Offline queue syncs (3 notes)", created == 3,
            f"{created}/3 created")


METRICS = [m1_noisy_extraction, m2_all_fields, m3_query_latency,
           m4_wo_creation_correct, m5_offline_sync]


def main() -> int:
    print("\n  VaakFlow — Success Metrics\n  " + "-" * 60)
    failures = 0
    for metric in METRICS:
        name, ok, detail = metric()
        failures += 0 if ok else 1
        mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
        print(f"  [{mark}] {name:<42} {detail}")
    print("  " + "-" * 60)
    print(f"  {len(METRICS) - failures}/{len(METRICS)} green\n")
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
