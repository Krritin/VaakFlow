# Mock mode → real providers (runbook)

VaakFlow runs **end-to-end with zero API keys**. Every external provider has a
deterministic mock; a real client is used only when its key is present (and
`FORCE_MOCK` is off). Flip them on one at a time.

## How selection works
`backend/app/config.py` exposes `use_real_llm`, `use_real_stt`,
`use_real_embeddings`, `use_real_graph`, `use_real_db`. Each is
`True` only when the relevant key is set and `FORCE_MOCK` is not `1`. Real SDKs
are imported lazily, so mock mode never needs them installed.

```bash
cp backend/.env.example backend/.env      # then fill in keys
pip install -r backend/requirements-full.txt   # only when going real
```

Check what's live:
```bash
curl localhost:8000/health   # -> providers: { llm: mock|real, ... }
```

## Flip order (recommended)
1. **LLM + STT — `GROQ_API_KEY`.** Real Llama routing/extraction/answers and
   Whisper transcription. Biggest quality jump; needed for the noisy-STT metric.
2. **Embeddings — `GEMINI_API_KEY`.** Switches the vector store to Chroma with
   Gemini embeddings (persists to `backend/data/chroma`). Run `make ingest`.
3. **Graph — `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD`.** Run
   `make seed` to push the seed graph to Aura.
4. **Work-order DB — `SUPABASE_URL` / `SUPABASE_KEY`.** Create the work-order
   table + realtime (Data lead task); the store seam is in `app/db/store.py`.
5. **Tracing — `LANGSMITH_API_KEY`** (+ `LANGCHAIN_TRACING_V2=true`).

## Notes / seams left for the team
- `SupabaseStore` and `Neo4jGraph` inherit the mock implementations so the demo
  keeps working; their real queries are marked `TODO(data-lead)`.
- The agent calls MCP tools **in-process** today; running them over the protocol
  (`python -m app.mcp_server.server` as an MCP client) is the next MCP step.
- `FORCE_MOCK=1` forces mocks even with keys present — handy for CI and offline
  dev.
