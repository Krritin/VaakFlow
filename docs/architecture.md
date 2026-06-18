# VaakFlow Architecture

Three surfaces, one brain.

```
 Worker PWA (Next.js)            Backend (FastAPI + LangGraph)         Supervisor
 ──────────────────             ──────────────────────────────        Dashboard
 push-to-talk  ───transcript──▶  /voice                               (Next.js)
 Web Speech STT                    │                                      ▲
 Web Speech TTS  ◀──reply──────  router ─┬─ extract ─ validate ─ persist  │ poll
 IndexedDB queue ──/sync──────▶          ├─ rewrite ─ retrieve ─ answer    │ 3s
                                          ├─ wo_action                     │
                                          ├─ escalate (A2A handoff)        │
                                          └─ clarify                       │
                                            │                              │
                          ┌─────────────────┼───────────────┬─────────────┘
                       MCP tools         RAG (vector       Work-order +
                     (work orders)    + graph, rerank)    alerts + activity
                          │                 │                   │
                       Store           Chroma / mem        Store (Supabase
                    (Supabase/mem)     + Neo4j/mem          / in-memory)
```

## Request flow (one turn)
1. **Worker PWA** captures speech with the browser Web Speech API and POSTs the
   transcript to `POST /voice` (audio path: `POST /transcribe` → Groq Whisper).
2. **LangGraph** runs: `router` classifies intent, then one branch:
   - `LOG_INSPECTION` → `extract` → `validate` → (`clarify` if a required field
     is missing, else `persist` via the MCP `create_work_order` tool).
   - `QUERY` → `rewrite` → `retrieve` (Chroma + Neo4j, re-ranked) →
     corrective-RAG confidence gate → `answer`.
   - `WORK_ORDER_ACTION` → `wo_action` (close/update; "close that one" resolves
     the last WO from checkpointed session state).
   - `ESCALATE` → `escalate` (sub-agent handoff: critical WO + dashboard alert).
   - `UNCLEAR` → `clarify`.
3. Every branch → `confirm` (verbal read-back) → `memory` (short + long term).
4. The reply is streamed back; the PWA speaks it with Web Speech TTS.
5. The **dashboard** polls `/work_orders`, `/alerts`, `/activity`.

## Endpoints
| Method | Path | Purpose |
| :-- | :-- | :-- |
| GET | `/health` | provider status (mock/real) + KB size |
| POST | `/voice` | one turn: transcript → graph → reply |
| POST | `/transcribe` | audio → text (Whisper, or browser-draft fallback) |
| POST | `/sync` | drain a batch of offline-queued notes |
| GET | `/work_orders` | dashboard board (filters: status/severity/site/worker) |
| GET | `/alerts` | escalation alerts |
| GET | `/activity` | worker activity feed |

## Provider abstraction (mock ⇄ real)
Each provider has a deterministic mock and a lazily-imported real client, chosen
by key presence in `backend/app/config.py`:

| Subsystem | Mock | Real (key) |
| :-- | :-- | :-- |
| LLM | heuristic router/extract/answer | Groq Llama / Gemini (`GROQ_API_KEY` / `GEMINI_API_KEY`) |
| STT | browser Web Speech draft | Groq Whisper (`GROQ_API_KEY`) |
| Embeddings | hashed bag-of-words | Gemini embeddings (`GEMINI_API_KEY`) |
| Vector store | in-memory cosine | Chroma (persistent) |
| Graph | in-memory seeded graph | Neo4j Aura (`NEO4J_*`) |
| Work-order DB | in-memory | Supabase (`SUPABASE_*`) |

See [mock-mode.md](./mock-mode.md) for flipping any of these to real.

## Syllabus mapping
The mapping of each course module to a concrete feature lives in the
[project plan](../VaakFlow_Project_Plan.md) §1. The agent graph (§4 there) is the
centrepiece; this doc is the implementer's view of it.
