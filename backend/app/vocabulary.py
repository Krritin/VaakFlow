"""Domain vocabulary loader.

Used to (a) bias Whisper decoding via its `prompt`, (b) drive heuristic
extraction in mock mode, and (c) re-validate extracted asset codes against the
known asset list (catches STT mis-hears).
"""
from __future__ import annotations

import difflib
import json
import re
from functools import lru_cache

_SEVERITY_LEVELS = ("low", "medium", "high", "critical")

from .config import DATA_DIR

_VOCAB_PATH = DATA_DIR / "vocabulary.json"

# spoken number-words -> digits, so "inverter seven" -> INV-07
_NUM_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12,
}


@lru_cache
def load_vocabulary() -> dict:
    with open(_VOCAB_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def whisper_prompt() -> str:
    return load_vocabulary().get("whisper_prompt", "")


def known_assets() -> list[str]:
    return load_vocabulary().get("assets", [])


def is_known_asset(asset_id: str | None) -> bool:
    if not asset_id:
        return False
    return asset_id.upper() in {a.upper() for a in known_assets()}


def normalize_number(token: str) -> int | None:
    token = token.strip().lower()
    if token.isdigit():
        return int(token)
    return _NUM_WORDS.get(token)


def extract_asset_id(text: str) -> str | None:
    """Find an asset code like INV-07 / 'inverter seven' / 'combiner box B'."""
    vocab = load_vocabulary()
    lowered = text.lower()

    # 1) direct code: INV-07, inv 7, str-2 ...
    m = re.search(r"\b(inv|cb|tx|str)[-\s]?(\d{1,3})\b", lowered)
    if m:
        prefix = m.group(1).upper()
        num = int(m.group(2))
        return f"{prefix}-{num:02d}"

    # 2) spoken: "inverter seven", "transformer one"
    word_to_prefix = {
        "inverter": "INV", "combiner": "CB", "combiner box": "CB",
        "transformer": "TX", "string": "STR",
    }
    for word, prefix in word_to_prefix.items():
        m = re.search(rf"{word}\s+(\w+)", lowered)
        if m:
            num = normalize_number(m.group(1))
            if num is not None:
                # strings are usually 1-digit; assets zero-padded to 2
                return f"{prefix}-{num:02d}" if prefix != "STR" else f"STR-{num}"

    # 3) combiner box letter: "combiner box B"
    m = re.search(r"combiner box ([a-z])\b", lowered)
    if m:
        return f"CB-{m.group(1).upper()}"

    return None


def match_fault_code(text: str) -> str | None:
    """Map a natural phrase to a fault code via vocabulary.phrase_to_fault.

    Also matches with filler ('any'/'the') dropped so 'not making any power'
    still resolves to 'not making power'.
    """
    lowered = text.lower()
    variants = (lowered, lowered.replace(" any ", " ").replace(" the ", " "))
    for phrase, code in load_vocabulary().get("phrase_to_fault", {}).items():
        if any(phrase in v for v in variants):
            return code
    return None


def match_severity(text: str) -> str | None:
    """Return a severity enum value if a severity word appears in the text.

    Tolerant of speech-to-text homophones: if no exact severity word matches,
    the word spoken right after "severity" is fuzzy-matched against the four
    levels — so a mis-heard "severity law" still resolves to "low" (and
    "criticle" -> critical, "med" -> medium, etc.).
    """
    lowered = text.lower()
    sev_words: dict[str, list[str]] = load_vocabulary().get("severity_words", {})

    # Priority 1: an explicit "severity <word>" statement is authoritative —
    # it beats an incidental severity word elsewhere (e.g. the "low" in "low
    # output"). Resolve the spoken word exactly, by alias, then fuzzily so a
    # mis-heard "severity law" -> low and "severity criticle" -> critical.
    m = re.search(r"severity\s+(?:is\s+|of\s+|was\s+|=\s*)?([a-z]+)", lowered)
    if m:
        spoken = m.group(1)
        for level in _SEVERITY_LEVELS:
            if spoken == level or spoken in sev_words.get(level, []):
                return level
        guess = difflib.get_close_matches(spoken, _SEVERITY_LEVELS, n=1, cutoff=0.6)
        if guess:
            return guess[0]

    # Priority 2: otherwise, any severity word in the text (strongest wins).
    for level in ("critical", "high", "medium", "low"):
        for word in sev_words.get(level, []):
            if re.search(rf"\b{re.escape(word)}\b", lowered):
                return level
    return None


def match_parts(text: str) -> list[str]:
    lowered = text.lower()
    found: list[str] = []
    for part in load_vocabulary().get("parts", []):
        # match either the slug or a spaced version ("string fuse 15a")
        spaced = part.replace("-", " ").lower()
        if part.lower() in lowered or spaced in lowered:
            found.append(part)
    return found


def extract_location(text: str) -> str | None:
    lowered = text.lower()
    parts: list[str] = []
    m = re.search(r"string\s+(\d+)", lowered)
    if m:
        parts.append(f"string {m.group(1)}")
    m = re.search(r"combiner box ([a-z])\b", lowered)
    if m:
        parts.append(f"combiner box {m.group(1).upper()}")
    return ", ".join(parts) if parts else None
