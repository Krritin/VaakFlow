"""Speech-to-text.

Real: Groq Whisper large-v3-turbo, biased with the domain vocabulary prompt.
Mock: returns the browser's on-device Web Speech draft (the offline-first
design) or a placeholder when no draft is supplied. This means the voice
round-trip works with zero keys, because the browser does the real STT.
"""
from __future__ import annotations

from . import vocabulary
from .config import settings


def transcribe(
    audio: bytes,
    *,
    filename: str = "audio.webm",
    content_type: str = "audio/webm",
    draft: str | None = None,
    language: str | None = None,
) -> tuple[str, str]:
    """Return (transcript, engine_name)."""
    if settings.use_real_stt and audio:
        try:
            from groq import Groq  # lazy

            client = Groq(api_key=settings.groq_api_key)
            result = client.audio.transcriptions.create(
                file=(filename, audio, content_type),
                model=settings.groq_stt_model,
                prompt=vocabulary.whisper_prompt(),  # domain bias
                language=language,  # optional; None lets Whisper auto-detect
                response_format="text",
            )
            text = result if isinstance(result, str) else getattr(result, "text", "")
            text = (text or "").strip()
            if text:  # only trust a non-empty real transcript
                return text, "groq-whisper"
        except Exception:  # noqa: BLE001 — fall back to the browser draft
            pass

    if draft:
        return draft.strip(), "mock(draft)"
    return (
        "(mock STT — no GROQ_API_KEY set; send the browser Web Speech draft "
        "as `transcript` instead)",
        "mock",
    )
