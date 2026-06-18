"""Chunking. Recursive-ish splitter: paragraphs first, then size with overlap.

Default ~500 chars / ~80 overlap — small enough that a single procedure step
lands in one chunk, large enough to keep context. (Justified in docs/rag.md.)
"""
from __future__ import annotations


def chunk_text(text: str, *, size: int = 500, overlap: int = 80) -> list[str]:
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buffer = ""
    for para in paragraphs:
        if len(buffer) + len(para) + 2 <= size:
            buffer = f"{buffer}\n\n{para}".strip()
        else:
            if buffer:
                chunks.append(buffer)
            if len(para) <= size:
                buffer = para
            else:
                # hard-split an oversized paragraph with overlap
                start = 0
                while start < len(para):
                    chunks.append(para[start:start + size])
                    start += size - overlap
                buffer = ""
    if buffer:
        chunks.append(buffer)
    return chunks
