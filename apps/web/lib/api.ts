export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export interface WorkOrder {
  work_order_id: string | null;
  worker_id: string;
  asset_id: string | null;
  site_id: string | null;
  inspection_result: string | null;
  fault_code: string | null;
  location: string | null;
  severity: string | null;
  action_taken: string | null;
  parts_required: string[];
  status: string;
  source_transcript: string | null;
  confidence: number;
  created_at: string | null;
}

export interface VoiceResponse {
  intent: string;
  transcript: string;
  reply: string;
  language: string;
  work_order: WorkOrder | null;
  answer_sources: string[];
  needs_clarification: boolean;
  escalated: boolean;
  confidence: number;
  latency_ms: number;
  trace: string[];
  mock_mode: boolean;
}

export interface VoiceRequest {
  transcript: string;
  worker_id?: string;
  session_id?: string;
  site_id?: string | null;
  language?: string | null;
}

export interface Alert {
  id: string;
  work_order_id: string | null;
  asset_id: string | null;
  severity: string;
  message: string;
  created_at: string;
}

export interface ActivityEvent {
  id: string;
  worker_id: string;
  kind: string;
  summary: string;
  transcript: string | null;
  created_at: string;
}

export async function postVoice(req: VoiceRequest): Promise<VoiceResponse> {
  const res = await fetch(`${API_BASE}/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`/voice ${res.status}`);
  return res.json();
}

export interface TranscribeResponse {
  transcript: string;
  engine: string; // "groq-whisper" | "mock(draft)" | "mock"
}

/**
 * POST recorded audio to /transcribe (Groq Whisper when available, else the
 * backend echoes the optional `draft` browser-Web-Speech transcript).
 * Multipart: file (+ optional draft, language).
 */
export async function postTranscribe(
  blob: Blob,
  draft?: string,
  language?: string
): Promise<TranscribeResponse> {
  const form = new FormData();
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  form.append("file", blob, `audio.${ext}`);
  if (draft) form.append("draft", draft);
  if (language) form.append("language", language);
  const res = await fetch(`${API_BASE}/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`/transcribe ${res.status}`);
  return res.json();
}

export interface HealthResponse {
  status: string;
  mock_mode: boolean;
  providers: {
    llm: string;
    stt: string;
    embeddings: string;
    embeddings_provider: string;
    graph_db: string;
    work_order_db: string;
    force_mock: string;
  };
  kb_chunks: number;
}

/** GET /health — provider modes (used to decide real Whisper vs Web Speech). */
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return getJSON<HealthResponse>("/health", signal);
}

export async function postSync(items: unknown[]): Promise<{
  processed: number;
  results: { client_id: string | null; response: VoiceResponse }[];
}> {
  const res = await fetch(`${API_BASE}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`/sync ${res.status}`);
  return res.json();
}

export async function getJSON<T>(
  path: string,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// ============================================================
// Analytics / BI endpoints
// ============================================================

export interface Stats {
  total: number;
  open: number;
  in_progress: number;
  closed: number;
  escalations: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  logged_today: number;
  closed_today: number;
  avg_confidence: number;
  active_workers: number;
  by_status: { open: number; in_progress: number; closed: number };
  by_severity: { low: number; medium: number; high: number; critical: number };
  by_site: Record<string, number>;
}

export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD
  count: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface TimeseriesResponse {
  days: number;
  points: TimeseriesPoint[]; // oldest -> newest
}

export interface WorkerStat {
  worker_id: string;
  total: number;
  open: number;
  escalations: number;
  last_active: string | null; // ISO8601
}

/** GET /stats?worker_id= — aggregate KPIs, optionally scoped to a worker. */
export async function getStats(
  workerId?: string,
  signal?: AbortSignal
): Promise<Stats> {
  const qs = workerId ? `?worker_id=${encodeURIComponent(workerId)}` : "";
  return getJSON<Stats>(`/stats${qs}`, signal);
}

/** GET /timeseries?days=&worker_id= — daily counts, oldest -> newest. */
export async function getTimeseries(
  days = 14,
  workerId?: string,
  signal?: AbortSignal
): Promise<TimeseriesResponse> {
  const params = new URLSearchParams({ days: String(days) });
  if (workerId) params.set("worker_id", workerId);
  return getJSON<TimeseriesResponse>(`/timeseries?${params.toString()}`, signal);
}

/** GET /workers — per-worker rollup. */
export async function getWorkers(signal?: AbortSignal): Promise<WorkerStat[]> {
  return getJSON<WorkerStat[]>("/workers", signal);
}

/** POST /work_orders/{id}/status — supervisor moves a WO open/in_progress/closed. */
export async function setWorkOrderStatus(
  id: string,
  status: "open" | "in_progress" | "closed"
): Promise<WorkOrder> {
  const res = await fetch(
    `${API_BASE}/work_orders/${encodeURIComponent(id)}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }
  );
  if (!res.ok) throw new Error(`/work_orders/${id}/status ${res.status}`);
  return res.json();
}
