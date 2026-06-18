"""LangGraph node implementations (§4).

Each node takes the current state and returns a partial update. Nodes append to
`trace` so the demo/UI can show the exact path a turn took.
"""
from __future__ import annotations

import re

from .. import vocabulary
from ..db import get_store
from ..llm import get_llm
from ..memory import get_long_term_memory
from ..mcp_server import tools
from ..rag import retrieve
from ..schemas import REQUIRED_WO_FIELDS, Intent
from .state import GraphState

_CONF_THRESHOLD = 0.45
_MAX_RAG_ATTEMPTS = 2
_ESCALATE_SEVERITIES = {"high", "critical"}


def _log(state: GraphState, msg: str) -> list[str]:
    return (state.get("trace") or []) + [msg]


# --------------------------------------------------------------------------- #
# Router
# --------------------------------------------------------------------------- #
def node_router(state: GraphState) -> dict:
    llm = get_llm()
    transcript = state["transcript"]
    language = state.get("language") or llm.detect_language(transcript)

    # If we're mid-clarification, treat this turn as the answer (slot-fill),
    # not a brand-new utterance to re-route.
    if state.get("awaiting_field"):
        return {
            "intent": Intent.LOG_INSPECTION.value,
            "language": language,
            "trace": _log(state, f"router -> slot-fill "
                                 f"('{state.get('awaiting_field')}')"),
        }

    intent = llm.route(transcript)
    return {
        "intent": intent.value,
        "language": language,
        "trace": _log(state, f"router -> {intent.value} (lang={language})"),
    }


# --------------------------------------------------------------------------- #
# LOG_INSPECTION: extract -> validate -> (clarify | persist) -> confirm
# --------------------------------------------------------------------------- #
_MERGE_FIELDS = ("asset_id", "inspection_result", "fault_code", "location",
                 "severity", "action_taken")


def node_extract(state: GraphState) -> dict:
    llm = get_llm()
    transcript = state["transcript"]
    raw = llm.extract_work_order(transcript)

    asset_id = raw.get("asset_id")
    if asset_id and not vocabulary.is_known_asset(asset_id):
        # keep it but flag — a mis-heard code shouldn't silently pass
        raw["asset_unverified"] = True

    awaiting = state.get("awaiting_field")
    pending = state.get("pending_wo")

    if awaiting and pending:
        # Slot-fill: keep everything we already have, fill blanks from the answer.
        wo = dict(pending)
        for field in _MERGE_FIELDS:
            if not wo.get(field) and raw.get(field):
                wo[field] = raw[field]
        if raw.get("parts_required"):
            wo["parts_required"] = sorted(
                {*(wo.get("parts_required") or []), *raw["parts_required"]}
            )
        # If they answered the "what's the fault?" question with words that don't
        # map to a known code, record their description so we don't loop.
        if awaiting == "fault_code" and not wo.get("fault_code"):
            # map the spoken fault to a canonical code if we can, else keep words
            code = vocabulary.match_fault_code(transcript)
            wo["fault_code"] = code or transcript.strip().rstrip(".")
            wo["inspection_result"] = wo.get("inspection_result") or "fail"
        convo = (state.get("convo") or []) + [f"Worker: {transcript}"]
    else:
        wo = {
            "worker_id": state.get("worker_id", "tech-unknown"),
            "site_id": state.get("site_id"),
            "asset_id": asset_id,
            "inspection_result": raw.get("inspection_result"),
            "fault_code": raw.get("fault_code"),
            "location": raw.get("location"),
            "severity": raw.get("severity"),
            "action_taken": raw.get("action_taken"),
            "parts_required": raw.get("parts_required", []),
            "confidence": raw.get("confidence", 0.0),
        }
        convo = [f"Worker: {transcript}"]

    wo.setdefault("worker_id", state.get("worker_id", "tech-unknown"))
    wo.setdefault("site_id", state.get("site_id"))
    wo.setdefault("confidence", raw.get("confidence", 0.0))
    wo["source_transcript"] = "\n".join(convo)

    return {
        "work_order": wo,
        "convo": convo,
        "confidence": wo.get("confidence", 0.0),
        "trace": _log(state, f"extract -> asset={wo.get('asset_id')} "
                             f"fault={wo.get('fault_code')} sev={wo.get('severity')}"),
    }


def node_validate(state: GraphState) -> dict:
    wo = state.get("work_order") or {}
    missing = [f for f in REQUIRED_WO_FIELDS if not wo.get(f)]
    return {
        "missing_fields": missing,
        "trace": _log(state, f"validate -> missing={missing or 'none'}"),
    }


def node_persist(state: GraphState) -> dict:
    wo = dict(state.get("work_order") or {})
    wo["inspection_result"] = wo.get("inspection_result") or "fail"  # a logged issue
    saved = tools.create_work_order(wo)  # MCP tool (schema-validated)
    wo_id = saved["work_order_id"]

    store = get_store()
    escalated = (saved.get("severity") in _ESCALATE_SEVERITIES)
    asset = saved.get("asset_id") or "unknown asset"

    reply = (
        f"Logged: {asset}"
        + (f", {saved['location']}" if saved.get("location") else "")
        + (f", {saved['fault_code']}" if saved.get("fault_code") else "")
        + f", severity {saved.get('severity') or 'unspecified'}. "
          f"Work order {wo_id} created."
    )

    if escalated:
        store.add_alert({
            "work_order_id": wo_id,
            "asset_id": saved.get("asset_id"),
            "severity": saved.get("severity"),
            "message": f"{(saved.get('severity') or '').upper()} fault on {asset} "
                       f"({saved.get('fault_code') or 'unspecified'})",
        })
        reply += " This is high severity — supervisor alerted."

    # Store the COMPLETE conversation (note + clarify Q&A + this confirmation) as
    # the single transcript, so the dashboard shows the whole exchange.
    full_convo = (state.get("convo") or []) + [f"VaakFlow: {reply}"]
    transcript = "\n".join(full_convo)
    store.update(wo_id, {"source_transcript": transcript})
    saved["source_transcript"] = transcript

    store.add_activity({
        "worker_id": saved.get("worker_id", "tech-unknown"),
        "kind": "inspection",
        "summary": reply,
        "transcript": transcript,
    })

    return {
        "work_order": saved,
        "last_work_order_id": wo_id,
        "escalated": escalated,
        "reply": reply,
        # clear clarification state for the next note
        "pending_wo": None,
        "awaiting_field": None,
        "clarify_rounds": 0,
        "convo": [],
        "trace": _log(state, f"persist -> {wo_id} (escalated={escalated})"),
    }


def node_clarify(state: GraphState) -> dict:
    """Two roles, by how we arrived here:
    - From validate (missing required fields): ask for the specific field.
    - From router UNCLEAR (greeting / small talk / off-domain): answer in-role
      (greet back or redirect) instead of demanding more detail.
    """
    missing = state.get("missing_fields") or []
    if missing:
        questions = {
            "asset_id": "Which equipment is this — for example INV-07?",
            "fault_code": "What's the fault on the machine? For example low "
                          "output, offline, or a ground fault.",
            "severity": "How severe is it — low, medium, high, or critical?",
        }
        field = missing[0]
        reply = questions.get(field, "Could you give a bit more detail?")
        rounds = state.get("clarify_rounds", 0) + 1
        convo = (state.get("convo") or []) + [f"VaakFlow: {reply}"]
        # Don't log an activity event for the clarify question itself — the final
        # persisted work order records the complete conversation (this question
        # and the worker's answer), so a clarify entry would just duplicate it.
        return {
            "reply": reply,
            "needs_clarification": True,
            # carry the partial work order so the next turn fills the blanks
            "pending_wo": state.get("work_order"),
            "awaiting_field": field,
            "clarify_rounds": rounds,
            "convo": convo,
            "trace": _log(state, f"clarify -> ask '{field}' (round {rounds})"),
        }

    # Conversational / off-domain: respond helpfully, stay in role.
    reply = get_llm().assist(state["transcript"])
    get_store().add_activity({
        "worker_id": state.get("worker_id", "tech-unknown"),
        "kind": "assist",
        "summary": reply,
        "transcript": state.get("transcript"),
    })
    return {
        "reply": reply,
        "needs_clarification": False,
        "trace": _log(state, "assist -> conversational reply"),
    }


# --------------------------------------------------------------------------- #
# WORK_ORDER_ACTION: close / update an existing WO ("close that one")
# --------------------------------------------------------------------------- #
def node_wo_action(state: GraphState) -> dict:
    transcript = state["transcript"].lower()
    m = re.search(r"\bwo[-\s]?(\d+)\b", transcript)
    target = f"WO-{m.group(1)}" if m else state.get("last_work_order_id")

    if not target:
        return {
            "reply": "I don't have a recent work order to act on. "
                     "Which work order number?",
            "needs_clarification": True,
            "trace": _log(state, "wo_action -> no target WO"),
        }

    notes_m = re.search(r"(parts ordered|replaced.*|isolated.*|reset.*)", transcript)
    notes = notes_m.group(0) if notes_m else None

    if "close" in transcript:
        result = tools.close_work_order(target, notes)
        verb = "closed"
    elif "reopen" in transcript:
        result = tools.update_work_order(target, {"status": "open"})
        verb = "reopened"
    else:
        result = tools.update_work_order(target, {"status": "in_progress"})
        verb = "updated to in-progress"

    if result is None:
        reply = f"I couldn't find work order {target}."
    else:
        reply = f"Done — work order {target} {verb}."

    get_store().add_activity({
        "worker_id": state.get("worker_id", "tech-unknown"),
        "kind": "action",
        "summary": reply,
        "transcript": state["transcript"],
    })
    return {
        "reply": reply,
        "work_order": result,
        "last_work_order_id": target,
        "trace": _log(state, f"wo_action -> {verb} {target}"),
    }


# --------------------------------------------------------------------------- #
# ESCALATE: Escalation sub-agent handoff (A2A) — critical priority WO + alert
# --------------------------------------------------------------------------- #
def node_escalate(state: GraphState) -> dict:
    llm = get_llm()
    transcript = state["transcript"]
    raw = llm.extract_work_order(transcript)

    wo = {
        "worker_id": state.get("worker_id", "tech-unknown"),
        "site_id": state.get("site_id"),
        "asset_id": raw.get("asset_id"),
        "inspection_result": raw.get("inspection_result") or "fail",
        "fault_code": raw.get("fault_code"),
        "location": raw.get("location"),
        "severity": "critical",  # escalation forces critical priority
        "action_taken": raw.get("action_taken"),
        "parts_required": raw.get("parts_required", []),
        "source_transcript": transcript,
        "confidence": raw.get("confidence", 0.0),
    }
    saved = tools.create_work_order(wo)
    wo_id = saved["work_order_id"]
    asset = saved.get("asset_id") or "unspecified asset"

    store = get_store()
    store.add_alert({
        "work_order_id": wo_id,
        "asset_id": saved.get("asset_id"),
        "severity": "critical",
        "message": f"CRITICAL: {asset} — {saved.get('fault_code') or transcript[:60]}",
    })
    reply = (f"Escalated. Critical work order {wo_id} created for {asset}. "
             "Supervisor has been alerted immediately.")
    store.add_activity({
        "worker_id": saved.get("worker_id", "tech-unknown"),
        "kind": "escalation",
        "summary": reply,
        "transcript": transcript,
    })
    return {
        "work_order": saved,
        "last_work_order_id": wo_id,
        "escalated": True,
        "reply": reply,
        "trace": _log(state, f"escalate(handoff) -> {wo_id}"),
    }


# --------------------------------------------------------------------------- #
# QUERY: rewrite -> retrieve(+rerank+graph) -> [confidence loop] -> answer
# --------------------------------------------------------------------------- #
def node_rewrite(state: GraphState) -> dict:
    llm = get_llm()
    attempts = state.get("rag_retries", 0)
    query = llm.rewrite_query(state["transcript"])
    if attempts >= 1:  # corrective RAG: widen on retry
        query = f"{query} overview specifications"
    return {
        "rewritten_query": query,
        "trace": _log(state, f"rewrite[{attempts}] -> '{query}'"),
    }


def node_retrieve(state: GraphState) -> dict:
    res = retrieve(state["rewritten_query"], source_text=state["transcript"])
    attempts = state.get("rag_retries", 0) + 1
    return {
        "context": res["context"],
        "sources": res["sources"],
        "confidence": res["top_score"],
        "rag_retries": attempts,
        "trace": _log(state, f"retrieve -> {res['num_chunks']} chunks, "
                             f"conf={res['top_score']} (attempt {attempts})"),
    }


def route_after_retrieve(state: GraphState) -> str:
    """Corrective-RAG gate: loop once on low confidence, else answer."""
    low = state.get("confidence", 0.0) < _CONF_THRESHOLD
    if low and state.get("rag_retries", 0) < _MAX_RAG_ATTEMPTS:
        return "rewrite"
    return "answer"


def node_answer(state: GraphState) -> dict:
    llm = get_llm()
    ltm = get_long_term_memory()
    context = state.get("context", "")

    recall = ltm.recall(state.get("worker_id", ""))
    if recall:
        context = f"[memory] {recall}\n\n{context}"

    answer = llm.answer(state["transcript"], context, state.get("sources", []))
    hedged = state.get("confidence", 0.0) < _CONF_THRESHOLD
    if hedged and "not certain" not in answer.lower():
        answer = "I'm not fully certain, but: " + answer

    get_store().add_activity({
        "worker_id": state.get("worker_id", "tech-unknown"),
        "kind": "query",
        "summary": answer,
        "transcript": state["transcript"],
    })
    return {
        "answer": answer,
        "reply": answer,
        "trace": _log(state, f"answer -> {len(state.get('sources', []))} sources, "
                             f"hedged={hedged}"),
    }


# --------------------------------------------------------------------------- #
# Confirm + Memory (shared tail)
# --------------------------------------------------------------------------- #
def node_confirm(state: GraphState) -> dict:
    # The branch already set a spoken read-back in `reply`; confirm just marks it.
    return {"trace": _log(state, "confirm -> read-back ready")}


def node_memory(state: GraphState) -> dict:
    ltm = get_long_term_memory()
    wo = state.get("work_order")
    if wo and wo.get("work_order_id"):
        ltm.remember_work_order(state.get("worker_id", "tech-unknown"), wo)
    return {
        "last_work_order_id": state.get("last_work_order_id"),
        "trace": _log(state, "memory -> updated short+long term"),
    }
