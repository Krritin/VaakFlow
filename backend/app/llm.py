"""LLM abstraction with a deterministic, domain-aware MockLLM.

MockLLM makes the entire agent runnable with zero API keys by replacing each
LLM task (routing, extraction, query-rewrite, answering, language detection)
with heuristics that mirror the real prompts in `prompts.py`. RealLLM uses Groq
(fast) with a Gemini fallback — the "Groq -> 429 -> Gemini" routing concept.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Protocol

from . import prompts, vocabulary
from .config import settings
from .schemas import Intent


# --------------------------------------------------------------------------- #
# Interface
# --------------------------------------------------------------------------- #
class LLM(Protocol):
    name: str

    def route(self, transcript: str) -> Intent: ...
    def extract_work_order(self, transcript: str) -> dict: ...
    def rewrite_query(self, transcript: str) -> str: ...
    def answer(self, question: str, context: str, sources: list[str]) -> str: ...
    def detect_language(self, text: str) -> str: ...
    def assist(self, transcript: str) -> str: ...


_FILLER = {
    "the", "a", "an", "is", "are", "was", "not", "please", "um", "uh", "like",
    "you", "know", "kind", "of", "sort", "just", "really", "so", "and", "to",
}
_ACTION_VERBS = (
    "isolated", "replaced", "reset", "cleaned", "tightened", "reconnected",
    "swapped", "logged", "inspected", "ordered", "checked", "tested",
)
_FAIL_WORDS = (
    "fail", "failed", "fault", "not working", "no power", "low output",
    "offline", "tripped", "broken", "blown", "leaking", "overheat",
)
_PASS_WORDS = ("pass", "passed", "ok", "okay", "normal", "healthy", "fine", "good")


# --------------------------------------------------------------------------- #
# Mock
# --------------------------------------------------------------------------- #
class MockLLM:
    name = "mock"

    # -- routing --
    def route(self, transcript: str) -> Intent:
        low = transcript.lower().strip()
        vocab = vocabulary.load_vocabulary()
        escalate_words = list(vocab.get("severity_words", {}).get("critical", []))

        if "escalate" in low or any(w in low for w in escalate_words):
            return Intent.ESCALATE

        # greeting / small talk with no equipment content -> conversational
        greetings = ("hi", "hello", "hey", "yo", "namaste", "good morning",
                     "good afternoon", "good evening", "how are you",
                     "how's it going", "what's up", "sup", "thanks", "thank you")
        has_domain = bool(
            vocabulary.extract_asset_id(low) or vocabulary.match_fault_code(low)
            or any(w in low for w in ("inverter", "combiner", "transformer",
                                      "string", "panel", "fault", "inspection",
                                      "work order", "procedure", "spec"))
        )
        if any(g in low for g in greetings) and not has_domain:
            return Intent.UNCLEAR

        # action on an existing work order ("close that one", "update WO-1042")
        if re.search(r"\b(close|reopen|update|mark)\b", low) and re.search(
            r"\b(that|it|this|work order|wo[-\s]?\d+|order)\b", low
        ):
            return Intent.WORK_ORDER_ACTION

        # question
        if "?" in transcript or re.search(
            r"\b(what|how|why|when|which|who|history|tell me|show me|explain|"
            r"procedure|spec|has|have|does|do)\b",
            low,
        ):
            return Intent.QUERY

        # inspection log
        if vocabulary.extract_asset_id(low) or any(w in low for w in _FAIL_WORDS) \
                or any(w in low for w in ("log", "inspect", "reading", "found")):
            return Intent.LOG_INSPECTION

        return Intent.UNCLEAR

    # -- extraction --
    def extract_work_order(self, transcript: str) -> dict:
        low = transcript.lower()
        fault_code = vocabulary.match_fault_code(low)

        if fault_code or any(w in low for w in _FAIL_WORDS):
            inspection_result: str | None = "fail"
        elif any(re.search(rf"\b{w}\b", low) for w in _PASS_WORDS):
            inspection_result = "pass"
        elif "partial" in low:
            inspection_result = "partial"
        else:
            inspection_result = None

        action_taken = None
        m = re.search(rf"\b({'|'.join(_ACTION_VERBS)})\b", low)
        if m:
            action_taken = transcript[m.start():].strip(" .,")

        wo = {
            "asset_id": vocabulary.extract_asset_id(transcript),
            "inspection_result": inspection_result,
            "fault_code": fault_code,
            "location": vocabulary.extract_location(transcript),
            "severity": vocabulary.match_severity(transcript),
            "action_taken": action_taken,
            "parts_required": vocabulary.match_parts(transcript),
        }
        filled = sum(1 for k in ("asset_id", "fault_code", "severity", "inspection_result") if wo[k])
        wo["confidence"] = round(min(0.95, 0.55 + 0.1 * filled), 2)
        return wo

    # -- query rewrite (GIGO fix) --
    def rewrite_query(self, transcript: str) -> str:
        asset = vocabulary.extract_asset_id(transcript)
        fault = vocabulary.match_fault_code(transcript)
        vocab = vocabulary.load_vocabulary()
        fault_desc = vocab.get("fault_codes", {}).get(fault, "") if fault else ""

        tokens = [t for t in re.split(r"\W+", transcript.lower()) if t and t not in _FILLER]
        cleaned = " ".join(tokens)
        parts = [asset or "", fault_desc or cleaned]
        if fault or "history" not in transcript.lower():
            parts.append("troubleshooting procedure")
        return " ".join(p for p in parts if p).strip()

    # -- grounded answer --
    def answer(self, question: str, context: str, sources: list[str]) -> str:
        if not context.strip():
            return ("I'm not certain — I couldn't find that in the manuals or "
                    "equipment history. Please check the printed procedure.")
        # strip source tags like "[graph] " / "[memory] " for a clean read-back
        clean = re.sub(r"\[[^\]]+\]\s*", "", context.strip())
        sentences = re.split(r"(?<=[.!?])\s+", clean)
        summary = " ".join(sentences[:2]).strip()
        if len(summary) > 320:
            summary = summary[:317].rstrip() + "..."
        src = f" Source: {sources[0]}." if sources else ""
        return f"{summary}{src}"

    # -- language detection (bonus: Hinglish) --
    def detect_language(self, text: str) -> str:
        if re.search(r"[ऀ-ॿ]", text):
            return "hi"
        hinglish = ("hai", "nahi", "kar", "karo", "theek", "raha", "rahi",
                    "bilkul", "kya", " kr ")
        low = f" {text.lower()} "
        if any(f" {w} " in low for w in hinglish):
            return "hinglish"
        return "en"

    # -- small talk / off-domain --
    def assist(self, transcript: str) -> str:
        low = transcript.lower()
        greetings = ("hi", "hello", "hey", "yo", "namaste", "good morning",
                     "good afternoon", "good evening", "how are you",
                     "how's it going", "what's up", "sup", "thanks", "thank you")
        if any(g in low for g in greetings):
            return ("I'm doing well, thanks — how can I help with your field work "
                    "today? You can log an inspection, ask about equipment, or "
                    "manage a work order.")
        return ("I'm your solar field assistant — I can log inspections, answer "
                "equipment questions, or update work orders. What would you like "
                "to do?")


# --------------------------------------------------------------------------- #
# Real (Groq primary, Gemini fallback) — lazy imports, only used when keyed
# --------------------------------------------------------------------------- #
def _strip_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(m.group(0)) if m else {}


class RealLLM:
    name = "real"

    def __init__(self) -> None:
        self._groq = None
        self._gemini = None
        if settings.groq_api_key:
            from groq import Groq  # lazy
            self._groq = Groq(api_key=settings.groq_api_key)
        if settings.gemini_key:
            import google.generativeai as genai  # lazy
            genai.configure(api_key=settings.gemini_key)
            self._gemini = genai
        # mock used as a safety net if a live call fails mid-demo
        self._fallback = MockLLM()

    def _chat(self, system: str, user: str, *, model: str | None = None,
              temperature: float = 0.2, max_tokens: int = 512) -> str:
        # Try Groq first (fast), then Gemini (the 429 fallback).
        if self._groq is not None:
            try:
                resp = self._groq.chat.completions.create(
                    model=model or settings.groq_llm_model,
                    messages=[{"role": "system", "content": system},
                              {"role": "user", "content": user}],
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                return resp.choices[0].message.content or ""
            except Exception:  # noqa: BLE001 — fall through to Gemini
                pass
        if self._gemini is not None:
            model_obj = self._gemini.GenerativeModel(
                settings.gemini_model, system_instruction=system
            )
            resp = model_obj.generate_content(
                user, generation_config={"temperature": temperature,
                                         "max_output_tokens": max_tokens}
            )
            return resp.text or ""
        raise RuntimeError("No real LLM available")

    def route(self, transcript: str) -> Intent:
        try:
            label = self._chat(prompts.ROUTER_SYSTEM, transcript,
                               model=settings.groq_router_model, temperature=0,
                               max_tokens=8).strip().upper()
            return Intent(label) if label in Intent.__members__ else Intent.UNCLEAR
        except Exception:  # noqa: BLE001
            return self._fallback.route(transcript)

    def extract_work_order(self, transcript: str) -> dict:
        try:
            fewshot = "\n".join(
                f"NOTE: {ex['note']}\nJSON: {json.dumps(ex['json'])}"
                for ex in prompts.EXTRACT_FEWSHOT
            )
            user = f"{fewshot}\n\nNOTE: {transcript}\nJSON:"
            data = _strip_json(self._chat(prompts.EXTRACT_SYSTEM, user,
                                          temperature=0, max_tokens=400))
            pr = data.get("parts_required")
            if isinstance(pr, str):
                data["parts_required"] = [p.strip() for p in pr.split(",") if p.strip()]
            elif not isinstance(pr, list):
                data["parts_required"] = []
            data["confidence"] = data.get("confidence", 0.85)
            return data
        except Exception:  # noqa: BLE001
            return self._fallback.extract_work_order(transcript)

    def rewrite_query(self, transcript: str) -> str:
        try:
            return self._chat(prompts.REWRITE_SYSTEM, transcript, temperature=0,
                              max_tokens=64).strip() or transcript
        except Exception:  # noqa: BLE001
            return self._fallback.rewrite_query(transcript)

    def answer(self, question: str, context: str, sources: list[str]) -> str:
        try:
            return self._chat(prompts.ANSWER_SYSTEM,
                              prompts.answer_user_prompt(question, context),
                              temperature=0.4, max_tokens=256).strip()
        except Exception:  # noqa: BLE001
            return self._fallback.answer(question, context, sources)

    def detect_language(self, text: str) -> str:
        return self._fallback.detect_language(text)

    def assist(self, transcript: str) -> str:
        try:
            out = self._chat(prompts.ASSIST_SYSTEM, transcript,
                             temperature=0.4, max_tokens=90).strip()
            return out or self._fallback.assist(transcript)
        except Exception:  # noqa: BLE001
            return self._fallback.assist(transcript)


@lru_cache
def get_llm() -> LLM:
    return RealLLM() if settings.use_real_llm else MockLLM()
