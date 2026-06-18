# 🎙️ VaakFlow — Voice-First AI Assistant for Field Workers

Hands-free assistant for solar-farm maintenance. A technician logs inspections,
asks about equipment history, and creates / closes / escalates work orders
entirely by voice — online or offline — while a supervisor dashboard updates live.

Assignment #11 (Voice AI). Everything runs on free tiers — Groq, NVIDIA NIM,
Supabase, and Neo4j AuraDB.

## Stack

- **Frontend** — Next.js 14 (App Router, TypeScript), PWA with an offline queue
- **Backend** — FastAPI + a LangGraph state machine (router → extract / query /
  action / escalate / clarify)
- **MCP** — work-order tools (create / update / close + spec / history)
- **Groq** — `llama-3.3-70b-versatile` (agent) + `whisper-large-v3` (speech-to-text)
- **NVIDIA NIM** — `nv-embedqa-e5-v5` (1024-dim embeddings for RAG)
- **Supabase** — Postgres (work orders + activity feed)
- **Neo4j AuraDB** — equipment knowledge graph (faults + repair history)
- **Browser Web Speech** — text-to-speech (free, on-device)

## Architecture

```
Worker PWA ──audio──▶ /transcribe ──▶ Groq Whisper
   │  Web Speech TTS      /voice ─────▶ LangGraph agent (Groq Llama-70b)
   │  IndexedDB queue          router → extract / query / action / escalate / clarify
   │  offline sync ─▶ /sync         tools: create / update / close work order (MCP)
   ▼                                hybrid RAG: NIM embeddings + Neo4j graph
Supervisor /dashboard ◀── polls ── backend ── Supabase (work_orders · activity · alerts)
```

## Setup

The backend (`backend/`) and the frontend (`apps/web/`) run as two services.

1. **Get the keys** (all free, no card):
   - `GROQ_API_KEY` — https://console.groq.com/keys
   - `NVIDIA_NIM_API_KEY` — https://build.nvidia.com
   - `SUPABASE_URL`, `SUPABASE_KEY` (service role) — Supabase → Project Settings → API
   - `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` — https://console.neo4j.io (AuraDB Free)

2. **Database** — paste [backend/supabase/schema.sql](backend/supabase/schema.sql)
   into the Supabase SQL editor and run it.

3. **Backend** (terminal 1):
   ```bash
   cd backend
   cp .env.example .env          # paste your keys
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements-full.txt
   PYTHONPATH=. python ../scripts/seed_neo4j.py     # seed the knowledge graph
   PYTHONPATH=. uvicorn app.main:app --reload --port 8000
   ```

4. **Frontend** (terminal 2):
   ```bash
   cd apps/web
   npm install
   npm run dev
   ```

5. Open **http://localhost:3000** (worker) and **/dashboard** (supervisor).
   Check **http://localhost:8000/health** to see which providers are live.

> Speech uses the browser Web Speech API, so use Chrome/Edge for the mic. The
> typed-note box works the same path everywhere else.

## Voice commands (examples)

- *"Inverter seven, string two, low output, severity high, I isolated the string."*
  → creates a work order and escalates it (high severity)
- *"Inverter eight is offline."* → asks back for the severity, then logs it
- *"When was the last time inverter nine was checked?"* → answers with the date
  and the worker who did it, from the log
- *"What faults has inverter seven had and how were they fixed?"* → hybrid
  graph + RAG answer
- *"Close that one, parts ordered."* → closes the last work order (session memory)

## Deploy

Two services: backend on **Render**, frontend on **Vercel**.

**Backend (Render)** — New Web Service, root directory `backend`:
- Build: `pip install -r requirements-full.txt`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Add the keys above as environment variables, plus `CORS_ORIGINS` set to your
  Vercel URL.

**Frontend (Vercel)** — Import the repo, root directory `apps/web`:
- Set `NEXT_PUBLIC_API_BASE` to your Render backend URL.

## Tests

```bash
cd backend && source .venv/bin/activate
PYTHONPATH=. pytest -q                        # smoke tests
PYTHONPATH=. python ../evals/run_evals.py     # 5 success metrics
```

## Docs

- [Architecture](./docs/architecture.md)
- [Real-API setup](./docs/real-apis.md)
- [LangGraph vs Agent SDK](./docs/sdk-vs-framework.md)
