"""Work-order + alert + activity store.

MockWorkOrderStore keeps everything in process memory so the dashboard,
work-order CRUD, and escalation alerts all work with no Supabase account. The
dashboard reads via polling endpoints; swap in SupabaseStore (realtime) by
setting SUPABASE_URL / SUPABASE_KEY.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from enum import Enum
from functools import lru_cache
from typing import Protocol

from ..config import settings

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _jsonable(value):
    """Coerce enum members (Severity/InspectionResult/WorkOrderStatus) to their
    plain string values so Supabase can serialize them. Lists are mapped too."""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


def _clean_row(row: dict) -> dict:
    """Make a dict safe to send to Supabase: enums -> strings, drop None
    work_order_id so the app-generated id is used as-is."""
    return {k: _jsonable(v) for k, v in row.items()}


class WorkOrderStore(Protocol):
    def create(self, wo: dict) -> dict: ...
    def get(self, wo_id: str) -> dict | None: ...
    def update(self, wo_id: str, patch: dict) -> dict | None: ...
    def delete(self, wo_id: str) -> None: ...
    def list(self, **filters) -> list[dict]: ...
    def add_alert(self, alert: dict) -> dict: ...
    def list_alerts(self) -> list[dict]: ...
    def add_activity(self, event: dict) -> dict: ...
    def list_activity(self, limit: int = 50) -> list[dict]: ...


class MockWorkOrderStore:
    """Thread-safe in-memory store. WO ids start at 1042 to match the demo."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._wos: dict[str, dict] = {}
        self._alerts: list[dict] = []
        self._activity: list[dict] = []
        self._wo_seq = 1042
        self._alert_seq = 1
        self._event_seq = 1

    def create(self, wo: dict) -> dict:
        with self._lock:
            wo = dict(wo)
            wo_id = wo.get("work_order_id") or f"WO-{self._wo_seq}"
            self._wo_seq += 1
            wo["work_order_id"] = wo_id
            # model_dump emits explicit None for unset keys, so coalesce rather
            # than setdefault (which would keep the None).
            wo["status"] = wo.get("status") or "open"
            wo["created_at"] = wo.get("created_at") or _now()
            self._wos[wo_id] = wo
            return wo

    def get(self, wo_id: str) -> dict | None:
        with self._lock:
            return self._wos.get(wo_id)

    def update(self, wo_id: str, patch: dict) -> dict | None:
        with self._lock:
            wo = self._wos.get(wo_id)
            if wo is None:
                return None
            wo.update({k: v for k, v in patch.items() if v is not None})
            wo["updated_at"] = _now()
            return wo

    def delete(self, wo_id: str) -> None:
        with self._lock:
            self._wos.pop(wo_id, None)

    def list(self, **filters) -> list[dict]:
        with self._lock:
            rows = list(self._wos.values())
        for key, val in filters.items():
            if val is not None:
                rows = [r for r in rows if r.get(key) == val]
        return sorted(rows, key=lambda r: r.get("created_at") or "", reverse=True)

    def add_alert(self, alert: dict) -> dict:
        with self._lock:
            alert = dict(alert)
            alert.setdefault("id", f"AL-{self._alert_seq}")
            self._alert_seq += 1
            alert.setdefault("created_at", _now())
            self._alerts.append(alert)
            return alert

    def list_alerts(self) -> list[dict]:
        with self._lock:
            return list(reversed(self._alerts))

    def add_activity(self, event: dict) -> dict:
        with self._lock:
            event = dict(event)
            event.setdefault("id", f"EV-{self._event_seq}")
            self._event_seq += 1
            event.setdefault("created_at", _now())
            self._activity.append(event)
            return event

    def list_activity(self, limit: int = 50) -> list[dict]:
        with self._lock:
            return list(reversed(self._activity))[:limit]


class SupabaseStore(MockWorkOrderStore):
    """Real Supabase-backed store (Postgres + realtime).

    Reads/writes the work_orders, alerts, and activity tables (see
    supabase/schema.sql) via the supabase python client. The client is imported
    lazily so the package isn't required in mock mode. Every method is wrapped:
    on any Supabase error we log and fall back to the inherited in-memory
    MockWorkOrderStore behaviour, so a misconfigured DB never breaks the demo.

    Dict shapes are kept identical to MockWorkOrderStore so the rest of the app
    (dashboard endpoints, analytics, MCP tools) needs no changes.
    """

    _WO_TABLE = "work_orders"
    _ALERT_TABLE = "alerts"
    _ACTIVITY_TABLE = "activity"

    def __init__(self) -> None:
        super().__init__()
        from supabase import create_client  # lazy — only when use_real_db

        self._client = create_client(settings.supabase_url, settings.supabase_key)
        # Seed the WO counter past any ids already in the DB so new ids don't
        # collide on restart. Falls back to the mock default (1042) on error.
        self._seed_seq()

    # ---- helpers ---------------------------------------------------------- #
    def _q(self, build):
        """Run a Supabase query, reconnecting and retrying once if the idle
        keep-alive socket was dropped ('Server disconnected'). Without this a
        transient drop silently falls back to in-memory (which the dashboard,
        reading Supabase, never sees)."""
        try:
            return build()
        except Exception:  # noqa: BLE001
            from supabase import create_client
            self._client = create_client(settings.supabase_url, settings.supabase_key)
            return build()

    def _next_seq(self, table: str, col: str, prefix: str, default: int) -> int:
        """Seed an id counter past the max already in `table`, so generated ids
        (WO-/AL-/EV-) don't collide with existing rows after a restart."""
        try:
            res = self._client.table(table).select(col).execute()
            max_n = default - 1
            for row in res.data or []:
                v = str(row.get(col) or "")
                tail = v[len(prefix):]
                if v.startswith(prefix) and tail.isdigit():
                    max_n = max(max_n, int(tail))
            return max_n + 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("SupabaseStore: could not seed %s sequence: %s", table, exc)
            return default

    def _seed_seq(self) -> None:
        self._wo_seq = self._next_seq(self._WO_TABLE, "work_order_id", "WO-", self._wo_seq)
        self._alert_seq = self._next_seq(self._ALERT_TABLE, "id", "AL-", self._alert_seq)
        self._event_seq = self._next_seq(self._ACTIVITY_TABLE, "id", "EV-", self._event_seq)

    # ---- work orders ------------------------------------------------------ #
    def create(self, wo: dict) -> dict:
        try:
            with self._lock:
                row = dict(wo)
                wo_id = row.get("work_order_id") or f"WO-{self._wo_seq}"
                self._wo_seq += 1
                row["work_order_id"] = wo_id
                row["status"] = row.get("status") or "open"
                row["created_at"] = row.get("created_at") or _now()
                payload = _clean_row(row)
            res = self._q(lambda: (
                self._client.table(self._WO_TABLE).insert(payload).execute()
            ))
            return (res.data or [payload])[0]
        except Exception as exc:  # noqa: BLE001
            logger.error("SupabaseStore.create failed, using in-memory: %s", exc)
            return super().create(wo)

    def get(self, wo_id: str) -> dict | None:
        try:
            res = self._q(lambda: (
                self._client.table(self._WO_TABLE).select("*")
                .eq("work_order_id", wo_id).limit(1).execute()
            ))
            rows = res.data or []
            return rows[0] if rows else None
        except Exception as exc:  # noqa: BLE001
            logger.error("SupabaseStore.get failed, using in-memory: %s", exc)
            return super().get(wo_id)

    def update(self, wo_id: str, patch: dict) -> dict | None:
        try:
            clean = _clean_row(
                {k: v for k, v in patch.items() if v is not None}
            )
            clean["updated_at"] = _now()
            res = self._q(lambda: (
                self._client.table(self._WO_TABLE).update(clean)
                .eq("work_order_id", wo_id).execute()
            ))
            rows = res.data or []
            return rows[0] if rows else None
        except Exception as exc:  # noqa: BLE001
            logger.error("SupabaseStore.update failed, using in-memory: %s", exc)
            return super().update(wo_id, patch)

    def delete(self, wo_id: str) -> None:
        try:
            self._q(lambda: self._client.table(self._WO_TABLE).delete().eq(
                "work_order_id", wo_id
            ).execute())
        except Exception as exc:  # noqa: BLE001
            logger.error("SupabaseStore.delete failed, using in-memory: %s", exc)
            super().delete(wo_id)

    def list(self, **filters) -> list[dict]:
        def run():
            q = self._client.table(self._WO_TABLE).select("*")
            for key in ("status", "severity", "site_id", "worker_id", "asset_id"):
                val = filters.get(key)
                if val is not None:
                    q = q.eq(key, _jsonable(val))
            return q.order("created_at", desc=True).execute()
        try:
            return self._q(run).data or []
        except Exception as exc:  # noqa: BLE001
            logger.error("SupabaseStore.list failed, using in-memory: %s", exc)
            return super().list(**filters)

    # ---- alerts ----------------------------------------------------------- #
    def add_alert(self, alert: dict) -> dict:
        try:
            with self._lock:
                row = dict(alert)
                row.setdefault("id", f"AL-{self._alert_seq}")
                self._alert_seq += 1
                row.setdefault("created_at", _now())
                payload = _clean_row(row)
            res = self._q(lambda: (
                self._client.table(self._ALERT_TABLE).insert(payload).execute()
            ))
            return (res.data or [payload])[0]
        except Exception as exc:  # noqa: BLE001
            logger.error("SupabaseStore.add_alert failed, using in-memory: %s", exc)
            return super().add_alert(alert)

    def list_alerts(self) -> list[dict]:
        try:
            res = self._q(lambda: (
                self._client.table(self._ALERT_TABLE).select("*")
                .order("created_at", desc=True).execute()
            ))
            return res.data or []
        except Exception as exc:  # noqa: BLE001
            logger.error("SupabaseStore.list_alerts failed, using in-memory: %s", exc)
            return super().list_alerts()

    # ---- activity --------------------------------------------------------- #
    def add_activity(self, event: dict) -> dict:
        try:
            with self._lock:
                row = dict(event)
                row.setdefault("id", f"EV-{self._event_seq}")
                self._event_seq += 1
                row.setdefault("created_at", _now())
                payload = _clean_row(row)
            res = self._q(lambda: (
                self._client.table(self._ACTIVITY_TABLE).insert(payload).execute()
            ))
            return (res.data or [payload])[0]
        except Exception as exc:  # noqa: BLE001
            logger.error("SupabaseStore.add_activity failed, using in-memory: %s", exc)
            return super().add_activity(event)

    def list_activity(self, limit: int = 50) -> list[dict]:
        try:
            res = self._q(lambda: (
                self._client.table(self._ACTIVITY_TABLE).select("*")
                .order("created_at", desc=True).limit(limit).execute()
            ))
            return res.data or []
        except Exception as exc:  # noqa: BLE001
            logger.error("SupabaseStore.list_activity failed, using in-memory: %s", exc)
            return super().list_activity(limit=limit)


@lru_cache
def get_store() -> WorkOrderStore:
    if settings.use_real_db:
        try:
            return SupabaseStore()
        except Exception:  # noqa: BLE001
            pass
    return MockWorkOrderStore()
