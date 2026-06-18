# VaakFlow backend — Hugging Face Spaces (Docker SDK) compatible.
# HF Spaces serves on port 7860.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps occasionally needed by ML wheels (sentence-transformers, chromadb)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install the full provider stack for production.
COPY requirements.txt requirements-full.txt ./
RUN pip install --upgrade pip && pip install -r requirements-full.txt

COPY app ./app
COPY data ./data

# Persistent Chroma index + checkpoints live under /app/data (mount on Spaces).
EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
