"""Text-to-speech.

By design TTS happens in the browser via the Web Speech `SpeechSynthesis` API
(zero latency, zero cost). This module exists so the backend can describe how a
reply should be spoken, and as a seam for an optional server voice (Deepgram
Aura) later. It never blocks the voice round-trip.
"""
from __future__ import annotations


def plan_speech(text: str, language: str = "en") -> dict:
    """Return a small spec the client uses to drive SpeechSynthesis."""
    # Map detected language to a BCP-47 hint for the browser voice picker.
    lang_map = {"en": "en-IN", "hi": "hi-IN", "hinglish": "hi-IN"}
    return {
        "text": text,
        "lang": lang_map.get(language, "en-IN"),
        "engine": "browser",
    }
