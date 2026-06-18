"""Pydantic data models — the work-order schema is the extraction target (§6)."""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #
class InspectionResult(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    PARTIAL = "partial"


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class WorkOrderStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    CLOSED = "closed"


class Intent(str, Enum):
    LOG_INSPECTION = "LOG_INSPECTION"
    QUERY = "QUERY"
    WORK_ORDER_ACTION = "WORK_ORDER_ACTION"
    ESCALATE = "ESCALATE"
    UNCLEAR = "UNCLEAR"


# --------------------------------------------------------------------------- #
# Work order (the structured extraction target)
# --------------------------------------------------------------------------- #
class WorkOrder(BaseModel):
    work_order_id: str | None = None  # server-generated, e.g. "WO-1042"
    worker_id: str = "tech-unknown"
    asset_id: str | None = None  # validated against Neo4j asset list
    site_id: str | None = None
    inspection_result: InspectionResult | None = None
    fault_code: str | None = None
    location: str | None = None
    severity: Severity | None = None
    action_taken: str | None = None
    parts_required: list[str] = Field(default_factory=list)
    status: WorkOrderStatus = WorkOrderStatus.OPEN
    source_transcript: str | None = None
    confidence: float = 0.0
    created_at: str | None = None


# Fields that must be present before a work order is persisted.
# A null among these routes the graph to the Clarify node (ask-back by voice).
REQUIRED_WO_FIELDS: tuple[str, ...] = ("asset_id", "fault_code", "severity")


# --------------------------------------------------------------------------- #
# API request / response models
# --------------------------------------------------------------------------- #
class VoiceRequest(BaseModel):
    """Primary turn input. `transcript` is the (browser-drafted or typed) text."""
    transcript: str
    worker_id: str = "tech-arjun"
    session_id: str = "default"
    site_id: str | None = "SITE-Bengaluru-3"
    language: str | None = None  # None -> auto-detect


class VoiceResponse(BaseModel):
    intent: Intent
    transcript: str
    reply: str  # spoken-style text for the client to read aloud (TTS)
    language: str = "en"
    work_order: WorkOrder | None = None
    answer_sources: list[str] = Field(default_factory=list)
    needs_clarification: bool = False
    escalated: bool = False
    confidence: float = 0.0
    latency_ms: int = 0
    trace: list[str] = Field(default_factory=list)  # node path, for demo/debug
    mock_mode: bool = True


class TranscribeResponse(BaseModel):
    transcript: str
    engine: str  # "groq-whisper" | "mock(draft)" | "mock"


class SyncItem(BaseModel):
    """One queued offline note (see §10)."""
    transcript: str
    worker_id: str = "tech-arjun"
    session_id: str = "default"
    site_id: str | None = "SITE-Bengaluru-3"
    client_id: str | None = None  # client-side id for reconciliation
    language: str | None = None


class SyncRequest(BaseModel):
    items: list[SyncItem]


class SyncResult(BaseModel):
    client_id: str | None
    response: VoiceResponse


class SyncResponse(BaseModel):
    processed: int
    results: list[SyncResult]


class Alert(BaseModel):
    id: str
    work_order_id: str | None
    asset_id: str | None
    severity: Severity
    message: str
    created_at: str


class ActivityEvent(BaseModel):
    id: str
    worker_id: str
    kind: str  # "inspection" | "query" | "action" | "escalation" | "clarify"
    summary: str
    transcript: str | None = None
    created_at: str


class StatusUpdate(BaseModel):
    status: WorkOrderStatus  # open | in_progress | closed
