"""Dashboard analytics — aggregations over the work-order store.

These power the read-only dashboard widgets (KPI cards, severity/status donuts,
the 14-day trend line, and the per-worker leaderboard). Everything is computed
on demand over `get_store()` so it stays correct whether the store is the
in-memory mock or a real backend.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from .db import get_store

_STATUSES = ("open", "in_progress", "closed")
_SEVERITIES = ("low", "medium", "high", "critical")


def _parse_date(value: str | None) -> date | None:
    """Best-effort parse of an ISO8601 timestamp -> its UTC calendar date."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).date()


def _filtered_orders(worker_id: str | None) -> list[dict]:
    rows = get_store().list()
    if worker_id:
        rows = [r for r in rows if r.get("worker_id") == worker_id]
    return rows


_ESCALATION_SEVERITIES = ("high", "critical")


def _is_escalation(r: dict) -> bool:
    """An active escalation = a high/critical work order that isn't closed."""
    return (
        r.get("severity") in _ESCALATION_SEVERITIES
        and (r.get("status") or "open") != "closed"
    )


def escalations(worker_id: str | None = None) -> list[dict]:
    """Escalation alerts derived from the live work orders (not a separate log),
    so closing or replacing a work order clears its escalation automatically."""
    out: list[dict] = []
    for r in _filtered_orders(worker_id):
        if not _is_escalation(r):
            continue
        sev = r.get("severity")
        asset = r.get("asset_id") or "unknown asset"
        out.append({
            "id": f"ESC-{r.get('work_order_id')}",
            "work_order_id": r.get("work_order_id"),
            "asset_id": r.get("asset_id"),
            "severity": sev,
            "message": f"{(sev or '').upper()} fault on {asset} "
                       f"({r.get('fault_code') or 'unspecified'})",
            "created_at": r.get("created_at"),
        })
    return sorted(out, key=lambda a: a.get("created_at") or "", reverse=True)


def stats(worker_id: str | None = None) -> dict:
    """KPI roll-up. When `worker_id` is given the aggregation is scoped to it."""
    rows = _filtered_orders(worker_id)
    today = datetime.now(timezone.utc).date()

    by_status: dict[str, int] = {s: 0 for s in _STATUSES}
    by_severity: dict[str, int] = {s: 0 for s in _SEVERITIES}
    by_site: dict[str, int] = defaultdict(int)

    logged_today = 0
    closed_today = 0
    workers: set[str] = set()

    for r in rows:
        status = r.get("status") or "open"
        if status in by_status:
            by_status[status] += 1

        severity = r.get("severity")
        if severity in by_severity:
            by_severity[severity] += 1

        site = r.get("site_id")
        if site:
            by_site[site] += 1

        if _parse_date(r.get("created_at")) == today:
            logged_today += 1

        if status == "closed":
            # Use the most recent of updated_at/created_at as the close date.
            closed_on = _parse_date(r.get("updated_at")) or _parse_date(
                r.get("created_at")
            )
            if closed_on == today:
                closed_today += 1

        wid = r.get("worker_id")
        if wid:
            workers.add(wid)

    # Escalations = live high/critical work orders that aren't closed.
    escalations_count = sum(1 for r in rows if _is_escalation(r))

    return {
        "total": len(rows),
        "open": by_status["open"],
        "in_progress": by_status["in_progress"],
        "closed": by_status["closed"],
        "escalations": escalations_count,
        "critical": by_severity["critical"],
        "high": by_severity["high"],
        "medium": by_severity["medium"],
        "low": by_severity["low"],
        "logged_today": logged_today,
        "closed_today": closed_today,
        "active_workers": len(workers),
        "by_status": dict(by_status),
        "by_severity": dict(by_severity),
        "by_site": dict(by_site),
    }


def timeseries(days: int = 14, worker_id: str | None = None) -> dict:
    """One zero-filled point per UTC day for the last `days`, oldest -> newest."""
    days = max(1, int(days))
    rows = _filtered_orders(worker_id)
    today = datetime.now(timezone.utc).date()

    # Window of calendar dates we report on (inclusive of today).
    window = [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]
    blank = lambda: {"count": 0, "critical": 0, "high": 0, "medium": 0, "low": 0}
    buckets: dict[date, dict] = {d: blank() for d in window}

    for r in rows:
        d = _parse_date(r.get("created_at"))
        if d is None or d not in buckets:
            continue
        bucket = buckets[d]
        bucket["count"] += 1
        sev = r.get("severity")
        if sev in bucket:
            bucket[sev] += 1

    points = [
        {
            "date": d.isoformat(),
            "count": buckets[d]["count"],
            "critical": buckets[d]["critical"],
            "high": buckets[d]["high"],
            "medium": buckets[d]["medium"],
            "low": buckets[d]["low"],
        }
        for d in window
    ]
    return {"days": days, "points": points}


def workers() -> list[dict]:
    """Per-worker leaderboard: counts + escalations + last activity timestamp."""
    rows = get_store().list()

    # Escalations per worker = their high/critical work orders that aren't closed.
    esc_by_worker: dict[str, int] = defaultdict(int)
    for r in rows:
        if _is_escalation(r):
            wid = r.get("worker_id")
            if wid:
                esc_by_worker[wid] += 1

    agg: dict[str, dict] = {}
    for r in rows:
        wid = r.get("worker_id")
        if not wid:
            continue
        entry = agg.setdefault(
            wid,
            {"worker_id": wid, "total": 0, "open": 0, "escalations": 0,
             "last_active": None},
        )
        entry["total"] += 1
        if (r.get("status") or "open") == "open":
            entry["open"] += 1
        created = r.get("created_at")
        if created and (entry["last_active"] is None or created > entry["last_active"]):
            entry["last_active"] = created

    for wid, entry in agg.items():
        entry["escalations"] = esc_by_worker.get(wid, 0)

    # Busiest workers first.
    return sorted(agg.values(), key=lambda e: e["total"], reverse=True)
