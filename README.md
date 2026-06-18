# ⚡ VaakFlow — Voice-First AI Assistant for Field Workers

Hands-free field assistant for **solar-farm maintenance**: a technician logs an
inspection, queries equipment history, creates/closes work orders, and escalates
faults **entirely by voice** — online or offline — while a supervisor dashboard
updates in real time.

> **This repo is the runnable foundation.** It boots **end-to-end with zero API
> keys** (every provider has a deterministic mock) and lights up real services
> when you add keys. See [`docs/`](./docs) for the architecture and runbooks.

---

## Quickstart (no API keys needed)

```bash
# Backend  (terminal 1)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. uvicorn app.main:app --reload --port 8000

# Frontend (terminal 2)
cd apps/web
npm install
npm run dev
```

Or run both at once: `./scripts/dev.sh`

Then open:
- **http://localhost:3000** — worker app (tap to speak, or type a note)
- **http://localhost:3000/dashboard** — supervisor board
- **http://localhost:8000/docs** — backend API (Swagger)

> The mic uses the browser **Web Speech API** (real STT/TTS, on-device, free).
> Use **Chrome/Edge** for speech; everywhere else, the typed-note box works the
> same path. Speech needs `localhost` or HTTPS.

## Try these (mock mode understands them)
| Say / type | What happens |
| :-- | :-- |
| "inverter seven string two low output, severity high, I isolated the string" | Logs **WO-1042**, extracts asset/fault/severity, **escalates** (high) |
| "inverter eight is offline" | Asks back — **clarify** ("what's the severity?") |
| "what faults has inverter seven had and how were they fixed?" | **Hybrid graph+RAG** answer with sources, < 3s |
| "close that one, parts ordered" | Closes the last WO via **session memory** |
| "emergency, smoke and sparking from inverter twelve" | **Escalation** sub-agent → critical WO + dashboard alert |

Every reply includes an **agent trace** (toggle in the UI) showing the exact
node path the turn took.

---

## What works right now (mock mode)
- ✅ Voice round-trip: push-to-talk → `/voice` → spoken reply (Web Speech STT/TTS)
- ✅ **LangGraph** state machine: router → extract / query / action / escalate /
  clarify, checkpointed (thread per worker session)
- ✅ Schema-constrained **extraction** + validation + clarify-by-voice loop
- ✅ **Hybrid RAG**: query-rewrite → vector (in-mem/Chroma) + **graph** facts →
  re-rank → corrective-RAG confidence gate → grounded answer
- ✅ **MCP tool layer** for work orders (`create`/`update`/`close` + spec/history)
- ✅ Short-term (session) + long-term (per-worker) **memory**
- ✅ **Escalation** handoff → critical WO + alert
- ✅ **Offline**: IndexedDB queue + `/sync` drain on reconnect (PWA + service worker)
- ✅ Supervisor **dashboard** (live board + alerts + activity feed)
- ✅ `evals/` — 5 success metrics as a green pass/fail table; CI runs tests + evals

## Going real
All mocks swap to real providers via `backend/.env` — see
[`docs/mock-mode.md`](./docs/mock-mode.md). Quick version:
```bash
cp backend/.env.example backend/.env          # add GROQ/GEMINI/NEO4J/SUPABASE keys
pip install -r backend/requirements-full.txt  # real provider SDKs
curl localhost:8000/health                     # confirms which are live
```

---

## Repo layout
```
VaakFlow/
├─ apps/web/              # Next.js PWA — worker (/) + dashboard (/dashboard)
├─ backend/
│  └─ app/
│     ├─ main.py          # FastAPI: /voice /transcribe /sync /work_orders ...
│     ├─ graph/           # LangGraph: state.py, nodes.py, build.py
│     ├─ rag/             # chunk, embed, store, rerank, retrieve, ingest
│     ├─ mcp_server/      # MCP tools (work orders) + FastMCP server
│     ├─ db/ graphdb/     # work-order store (Supabase/mem) + graph (Neo4j/mem)
│     ├─ memory/          # short_term (thread) + long_term (per-worker)
│     ├─ llm.py stt.py    # provider abstractions (mock + lazy real)
│     └─ schemas.py       # Pydantic work-order schema (extraction target)
├─ knowledge_base/        # solar manuals (RAG source)
├─ scripts/               # seed_neo4j.py, ingest_kb.py, dev.sh
├─ evals/                 # success-metric harness
├─ docs/                  # architecture, sdk-vs-framework, mock-mode
└─ .github/workflows/     # CI (tests + evals + frontend build)
```

## Tests & evals
```bash
cd backend && source .venv/bin/activate
PYTHONPATH=. pytest -q                       # backend smoke tests
PYTHONPATH=. python ../evals/run_evals.py    # 5 success metrics
```

## Docs
- [Architecture](./docs/architecture.md) — surfaces, request flow, endpoints
- [LangGraph vs Agent SDK](./docs/sdk-vs-framework.md)
- [Mock → real runbook](./docs/mock-mode.md)

## Roadmap (next checklist items, per plan §14)
Real provider wiring (Groq/Gemini/Neo4j/Supabase) · MCP-over-protocol client ·
LangSmith tracing · deploy (Vercel + HF Spaces) · Hinglish bonus.

---
*100% free-tier stack. Build mode: demo-grade — every feature works end-to-end.*
