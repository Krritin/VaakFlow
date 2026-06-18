"""Long-term memory: per-worker facts that outlive a session.

Stores recent assets, recurring faults, and the last work order per worker.
Crucially we *inject a small recalled slice* into context (see `recall`) rather
than dumping history — memory != context window.
"""
from __future__ import annotations

import threading
from functools import lru_cache


class LongTermMemory:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._by_worker: dict[str, dict] = {}

    def _bucket(self, worker_id: str) -> dict:
        return self._by_worker.setdefault(
            worker_id,
            {"recent_assets": [], "recurring_faults": {}, "last_work_order_id": None},
        )

    def remember_work_order(self, worker_id: str, wo: dict) -> None:
        with self._lock:
            m = self._bucket(worker_id)
            if wo.get("work_order_id"):
                m["last_work_order_id"] = wo["work_order_id"]
            asset = wo.get("asset_id")
            if asset:
                if asset in m["recent_assets"]:
                    m["recent_assets"].remove(asset)
                m["recent_assets"] = ([asset] + m["recent_assets"])[:5]
            code = wo.get("fault_code")
            if code:
                m["recurring_faults"][code] = m["recurring_faults"].get(code, 0) + 1

    def last_work_order_id(self, worker_id: str) -> str | None:
        with self._lock:
            return self._bucket(worker_id)["last_work_order_id"]

    def recall(self, worker_id: str) -> str:
        """A short, selectively-injected memory slice for answer context."""
        with self._lock:
            m = self._bucket(worker_id)
            bits: list[str] = []
            if m["recent_assets"]:
                bits.append("recently worked: " + ", ".join(m["recent_assets"]))
            recurring = [c for c, n in m["recurring_faults"].items() if n >= 2]
            if recurring:
                bits.append("recurring faults: " + ", ".join(recurring))
            return "; ".join(bits)


@lru_cache
def get_long_term_memory() -> LongTermMemory:
    return LongTermMemory()
