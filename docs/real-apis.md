# Going Live: Real APIs Setup

VaakFlow runs **fully end-to-end in mock mode with zero keys**. Every provider
below is **optional, free, and needs no credit card**. Add a key, restart the
backend, and that subsystem flips from MOCK to REAL automatically.

## How selection works

Selection is driven by `backend/app/config.py` — never by hard-coded keys.
A subsystem goes real when its key(s) are present and `FORCE_MOCK=0`. Real SDKs
are imported lazily inside `try/except`, so if a SDK is missing or a call fails,
the app silently falls back to the deterministic mock and keeps working.

```
FORCE_MOCK=1   # force everything to mock, even when keys are set
```

## Setup (once)

```bash
cp backend/.env.example backend/.env          # fill in the keys you want
pip install -r backend/requirements-real.txt  # lean real SDKs (no torch)
```

Edit `backend/.env` and paste keys per the tiers below.

---

## Tier 1 — Groq  (highest impact: real LLM + real STT)

Unlocks **Llama-3.3-70B** responses **and** **Whisper** speech-to-text from one key.

1. Go to **https://console.groq.com** and sign in.
2. Open **API Keys** in the left nav.
3. Click **Create API Key**, name it, and **copy** the `gsk_...` value.
4. Paste it into `backend/.env`:
   ```
   GROQ_API_KEY=gsk_...
   ```

Verify: `/health` shows `"llm": "real"` and `"stt": "real"`.

---

## Tier 2 — Embeddings  (real semantic RAG)

Pick **either** provider. `EMBEDDINGS_PROVIDER` controls which one runs:
`auto` (default) | `gemini` | `nim` | `mock`. `auto` prefers Gemini if its key
is set, else NVIDIA NIM, else mock.

### Option A — Google Gemini (also enables multimodal / long-context LLM)

1. Go to **https://aistudio.google.com/apikey**.
2. Click **Create API key**.
3. **Copy** the `AIza...` value into `backend/.env`:
   ```
   GEMINI_API_KEY=AIza...
   ```

### Option B — NVIDIA NIM  (`nv-embedqa-e5-v5`, 1024-d)

1. Go to **https://build.nvidia.com** and sign in.
2. Open an **embedding** model (e.g. `nvidia/nv-embedqa-e5-v5`).
3. Click **Get API Key** / **Generate API Key** and **copy** the `nvapi-...` value:
   ```
   NVIDIA_NIM_API_KEY=nvapi-...
   ```

Optionally pin the backend:
```
EMBEDDINGS_PROVIDER=nim   # or gemini / mock / auto
```

Verify: `/health` shows `"embeddings": "real"` and
`"embeddings_provider": "gemini"` (or `"nim"`).

---

## Tier 3 — Supabase  (real work-order persistence + realtime)

1. Go to **https://supabase.com/dashboard** and **create a project** (wait for it
   to finish provisioning).
2. Open **Project Settings -> API**.
3. **Copy "Project URL"** -> `SUPABASE_URL`.
4. **Copy the `service_role` key** (secret — **not** the anon key) -> `SUPABASE_KEY`.
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_KEY=eyJ...   # service_role
   ```
5. First time only: open the **SQL Editor** and run the table schema
   (`schema.sql`) to create the work-order tables.

Verify: `/health` shows `"work_order_db": "real"`.

---

## Tier 4 — Neo4j AuraDB Free  (real knowledge graph)

1. Go to **https://console.neo4j.io** and click **New Instance -> AuraDB Free**.
2. On creation, **download/copy the generated password** — it's shown **only once**.
3. **Copy the connection URI** (`neo4j+s://xxxx.databases.neo4j.io`) -> `NEO4J_URI`.
4. Username is `neo4j`. Paste the saved password -> `NEO4J_PASSWORD`:
   ```
   NEO4J_URI=neo4j+s://xxxx.databases.neo4j.io
   NEO4J_USERNAME=neo4j
   NEO4J_PASSWORD=...
   ```
5. Seed the graph:
   ```bash
   make seed
   ```

Verify: `/health` shows `"graph_db": "real"`.

---

## Optional — LangSmith tracing

1. Go to **https://smith.langchain.com -> Settings -> API Keys**, create a key.
2. Paste it: `LANGSMITH_API_KEY=...` (uncomment `LANGCHAIN_TRACING_V2=true`).

---

## Verify everything

Restart the backend, then check the health endpoint:

```bash
make backend                       # restart to pick up .env changes
curl -s localhost:8000/health | jq .providers
```

Example output with all tiers live:

```json
{
  "llm": "real",
  "stt": "real",
  "embeddings": "real",
  "embeddings_provider": "gemini",
  "graph_db": "real",
  "work_order_db": "real",
  "force_mock": "false"
}
```

Any value still `"mock"` means that tier's key is missing/invalid (or
`FORCE_MOCK=1`) — the app keeps running regardless.
