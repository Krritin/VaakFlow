"""VaakFlow FastAPI backend.

Endpoints:
  GET  /health            provider status + KB size
  POST /voice             one conversational turn (transcript -> graph -> reply)
  POST /transcribe        audio -> text (Groq Whisper, or browser-draft fallback)
  POST /sync              drain a batch of offline-queued notes
  GET  /work_orders       dashboard board (+ filters)
  GET  /alerts            escalation alerts
  GET  /activity          worker activity feed
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import analytics, stt
from .config import settings
from .db import get_store
from .demo_seed import seed_demo_data
from .graph import run_turn
from .rag.ingest import ingest_knowledge_base
from .schemas import (
    Intent,
    StatusUpdate,
    SyncRequest,
    SyncResponse,
    SyncResult,
    TranscribeResponse,
    VoiceRequest,
    VoiceResponse,
    WorkOrder,
)
from .vocabulary import load_vocabulary

_kb_chunks = 0


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _kb_chunks
    load_vocabulary()  # warm the cache
    _kb_chunks = ingest_knowledge_base()  # index manuals into the vector store
    seed_demo_data()  # backfill a busy week of demo work orders (idempotent)
    run_turn  # graph app is built lazily on first turn
    yield


app = FastAPI(title="VaakFlow", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=(["*"] if settings.cors_origins.strip() == "*"
                   else [o.strip() for o in settings.cors_origins.split(",")]),
    allow_methods=["*"],
    allow_headers=["*"],
)


def _to_voice_response(transcript: str, final: dict, latency_ms: int) -> VoiceResponse:
    wo = final.get("work_order")
    return VoiceResponse(
        intent=Intent(final.get("intent") or "UNCLEAR"),
        transcript=transcript,
        reply=final.get("reply", ""),
        language=final.get("language", "en"),
        work_order=WorkOrder(**wo) if wo else None,
        answer_sources=final.get("sources", []),
        needs_clarification=final.get("needs_clarification", False),
        escalated=final.get("escalated", False),
        confidence=round(float(final.get("confidence", 0.0)), 3),
        latency_ms=latency_ms,
        trace=final.get("trace", []),
        mock_mode=not settings.use_real_llm,
    )


@app.get("/")
def root() -> dict:
    return {"service": "VaakFlow", "version": app.version, "docs": "/docs"}


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "mock_mode": not settings.use_real_llm,
        "providers": settings.provider_status(),
        "kb_chunks": _kb_chunks,
    }


@app.post("/voice", response_model=VoiceResponse)
def voice(req: VoiceRequest) -> VoiceResponse:
    t0 = time.perf_counter()
    final = run_turn(
        req.transcript,
        worker_id=req.worker_id,
        session_id=req.session_id,
        site_id=req.site_id,
        language=req.language,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)
    return _to_voice_response(req.transcript, final, latency_ms)


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(...),
    draft: str | None = Form(None),
    language: str | None = Form(None),
) -> TranscribeResponse:
    audio = await file.read()
    text, engine = stt.transcribe(
        audio,
        filename=file.filename or "audio.webm",
        content_type=file.content_type or "audio/webm",
        draft=draft,
        language=language,
    )
    return TranscribeResponse(transcript=text, engine=engine)


@app.post("/sync", response_model=SyncResponse)
def sync(req: SyncRequest) -> SyncResponse:
    results: list[SyncResult] = []
    for item in req.items:
        t0 = time.perf_counter()
        final = run_turn(
            item.transcript,
            worker_id=item.worker_id,
            session_id=item.session_id,
            site_id=item.site_id,
            language=item.language,
        )
        latency_ms = int((time.perf_counter() - t0) * 1000)
        results.append(SyncResult(
            client_id=item.client_id,
            response=_to_voice_response(item.transcript, final, latency_ms),
        ))
    return SyncResponse(processed=len(results), results=results)


@app.get("/work_orders")
def work_orders(
    status: str | None = None,
    severity: str | None = None,
    site_id: str | None = None,
    worker_id: str | None = None,
    asset_id: str | None = None,
) -> list[dict]:
    return get_store().list(
        status=status, severity=severity, site_id=site_id,
        worker_id=worker_id, asset_id=asset_id,
    )


@app.get("/work_orders/{work_order_id}")
def work_order(work_order_id: str) -> dict:
    return get_store().get(work_order_id) or {"error": "not found",
                                              "work_order_id": work_order_id}


@app.post("/work_orders/{work_order_id}/status")
def set_work_order_status(work_order_id: str, body: StatusUpdate) -> dict:
    """Supervisor action: move a work order between open / in_progress / closed."""
    wo = get_store().update(work_order_id, {"status": body.status.value})
    return wo or {"error": "not found", "work_order_id": work_order_id}


@app.get("/alerts")
def alerts() -> list[dict]:
    # Derived from live work orders (high/critical & not closed) so closing or
    # replacing a work order clears its escalation automatically.
    return analytics.escalations()


@app.get("/activity")
def activity(limit: int = 50) -> list[dict]:
    return get_store().list_activity(limit=limit)


@app.get("/stats")
def stats(worker_id: str | None = None) -> dict:
    return analytics.stats(worker_id=worker_id)


@app.get("/timeseries")
def timeseries(days: int = 14, worker_id: str | None = None) -> dict:
    return analytics.timeseries(days=days, worker_id=worker_id)


@app.get("/workers")
def workers() -> list[dict]:
    return analytics.workers()
