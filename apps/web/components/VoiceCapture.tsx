"use client";

// ============================================================
// VaakFlow — VoiceCapture hero (signature amber/gold glow card)
// Capture modes:
//   • Push to talk     — records, auto-stops when you pause (VAD)
//   • Start recording  — records until you tap Stop & send
//   • Hands-free       — say "hey field" to trigger push-to-talk
// Online + Groq  -> record audio -> /transcribe (Whisper).
// Offline / mock / no recorder -> browser Web Speech (on-device);
//   submit() then queues it to IndexedDB while offline.
// Preserves: typed fallback, offline enqueue + flush on reconnect,
//   "Sync now", and the full response card.
// ============================================================

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  postVoice,
  postSync,
  postTranscribe,
  getHealth,
  type VoiceResponse,
  type VoiceRequest,
} from "../lib/api";
import {
  listenOnce,
  listenContinuous,
  recognitionSupported,
  speak,
  type ContinuousListener,
} from "../lib/speech";
import { useRecorder, recorderSupported, attachVAD } from "../lib/recorder";
import {
  enqueue,
  getQueue,
  queueCount,
  registerBackgroundSync,
  removeItems,
  type QueuedNote,
} from "../lib/offline";
import { Badge, Card, SectionLabel } from "./ui";
import {
  intentLabel,
  num,
  pct,
  severityTone,
  statusTone,
} from "../lib/format";

const SITE = "SITE-Bengaluru-3";
const WAKE_PHRASES = [
  "hey field",
  "hey vaak",
  "hey flow",
  "hey vaakflow",
  "hey assistant",
];

function langTag(lang: string): string {
  return lang === "hi" || lang === "hinglish" ? "hi-IN" : "en-IN";
}

export interface VoiceCaptureProps {
  worker_id: string;
  session_id: string;
  /** Notifies the parent whenever the offline queue length changes. */
  onQueueChange?: (count: number) => void;
}

type RecMode = null | "ptt" | "manual";

export default function VoiceCapture({
  worker_id,
  session_id,
  onQueueChange,
}: VoiceCaptureProps) {
  const [typed, setTyped] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<VoiceResponse | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [showTrace, setShowTrace] = useState(false);
  const [realStt, setRealStt] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecMode>(null);
  const [handsFree, setHandsFree] = useState(false);
  const recorder = useRecorder();

  const vadCleanupRef = useRef<(() => void) | null>(null);
  const captureDoneRef = useRef<(() => void) | null>(null);
  const recordingModeRef = useRef<RecMode>(null);
  const recogRef = useRef<ContinuousListener | null>(null);
  const handsFreeRef = useRef(false);
  const usedVoiceRef = useRef(false); // has the worker used the mic this session?
  const startCaptureRef = useRef<
    ((mode: "ptt" | "manual", onDone?: () => void) => void) | null
  >(null);

  const refreshQueue = useCallback(async () => {
    try {
      const c = await queueCount();
      setQueued(c);
      onQueueChange?.(c);
    } catch {
      /* indexedDB unavailable */
    }
  }, [onQueueChange]);

  const flushQueue = useCallback(async () => {
    let q: QueuedNote[] = [];
    try {
      q = await getQueue();
    } catch {
      return;
    }
    if (!q.length) return;
    setStatus(`Syncing ${q.length} queued note(s)…`);
    try {
      const out = await postSync(q);
      await removeItems(q.map((n) => n.client_id));
      const last = out.results[out.results.length - 1];
      if (last) setResp(last.response);
      setStatus(`Synced ${out.processed} note(s).`);
      speak(`Synced ${out.processed} offline notes.`);
    } catch {
      setStatus("Sync failed — still offline. Will retry.");
    } finally {
      refreshQueue();
    }
  }, [refreshQueue]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refreshQueue();
    const goOnline = () => {
      setOnline(true);
      flushQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flushQueue, refreshQueue]);

  // Detect STT mode once: real Groq Whisper recording vs. browser Web Speech.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await getHealth();
        if (!cancelled) setRealStt(h.providers?.stt === "real");
      } catch {
        if (!cancelled) setRealStt(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const queueNote = useCallback(
    async (transcript: string) => {
      const note: QueuedNote = {
        client_id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        transcript,
        worker_id,
        session_id,
        site_id: SITE,
        created_at: new Date().toISOString(),
      };
      await enqueue(note);
      await registerBackgroundSync();
      setStatus("Saved offline — will sync on reconnect.");
      speak("Saved offline. I'll sync when you're back online.");
      refreshQueue();
    },
    [worker_id, session_id, refreshQueue]
  );

  // onTurnComplete fires when the whole turn is done — i.e. after any
  // clarify follow-ups resolve (used by hands-free to re-arm the wake word).
  const submit = useCallback(
    async (text: string, opts?: { onTurnComplete?: () => void }) => {
      const transcript = text.trim();
      if (!transcript) {
        opts?.onTurnComplete?.();
        return;
      }
      setBusy(true);
      setStatus("");
      const req: VoiceRequest = {
        transcript,
        worker_id,
        session_id,
        site_id: SITE,
      };
      // Offline -> queue immediately (no network round-trip).
      if (!navigator.onLine) {
        await queueNote(transcript);
        setBusy(false);
        opts?.onTurnComplete?.();
        return;
      }
      try {
        const r = await postVoice(req);
        setResp(r);
        speak(r.reply, langTag(r.language), () => {
          // The agent asked a follow-up -> auto-open the mic for the answer
          // (only when voice was already used, so typed-only flows aren't
          // surprised by a permission prompt). Threads onTurnComplete through.
          const autoMic =
            r.needs_clarification &&
            navigator.onLine &&
            usedVoiceRef.current &&
            (recorderSupported() || recognitionSupported());
          if (autoMic && startCaptureRef.current) {
            startCaptureRef.current("ptt", opts?.onTurnComplete);
          } else {
            opts?.onTurnComplete?.();
          }
        });
      } catch {
        await queueNote(transcript); // backend unreachable -> queue it
        opts?.onTurnComplete?.();
      } finally {
        setBusy(false);
        setTyped("");
      }
    },
    [worker_id, session_id, queueNote]
  );

  // --- Browser Web Speech (on-device): used in mock mode AND when offline, so
  // a captured note still gets a draft transcript that submit() can queue. ---
  const startBrowserListen = useCallback(
    (onDone?: () => void) => {
      if (!recognitionSupported()) {
        setStatus("Speech recognition unavailable — type your note below.");
        onDone?.();
        return;
      }
      usedVoiceRef.current = true;
      setListening(true);
      setStatus(
        navigator.onLine ? "Listening…" : "Listening… (offline — will queue)"
      );
      listenOnce({
        lang: "en-IN",
        onResult: (text) => {
          setTyped(text);
          void submit(text, { onTurnComplete: onDone });
        },
        onError: (err) => {
          setStatus(`Mic error: ${err}. You can type instead.`);
          setListening(false);
          onDone?.();
        },
        onEnd: () => {
          setListening(false);
          setStatus((s) => (s.startsWith("Listening") ? "" : s));
        },
      });
    },
    [submit]
  );

  // --- Stop the active recording, transcribe via Whisper, submit. ---
  const finishCapture = useCallback(async () => {
    if (vadCleanupRef.current) {
      vadCleanupRef.current();
      vadCleanupRef.current = null;
    }
    const onDone = captureDoneRef.current;
    captureDoneRef.current = null;
    recordingModeRef.current = null;
    setRecordingMode(null);
    setListening(false);
    setBusy(true);
    setStatus("Transcribing…");
    try {
      const blob = await recorder.end();
      const { transcript } = await postTranscribe(blob, undefined, "en");
      const text = transcript.trim();
      if (!text) {
        setStatus("Didn't catch that — try again or type below.");
        onDone?.();
        return;
      }
      setTyped(text);
      await submit(text, { onTurnComplete: onDone ?? undefined });
    } catch {
      setStatus("Transcription failed — you can type instead.");
      onDone?.();
    } finally {
      setBusy(false);
      setStatus((s) => (s === "Transcribing…" ? "" : s));
    }
  }, [recorder, submit]);

  // --- Start a capture. "ptt" auto-stops on silence; "manual" needs a Stop
  // tap. Online + Groq records audio (Whisper); otherwise browser STT. ---
  const startCapture = useCallback(
    async (mode: "ptt" | "manual", onDone?: () => void) => {
      usedVoiceRef.current = true;
      const canWhisper = navigator.onLine && realStt && recorderSupported();
      if (!canWhisper) {
        // Offline / mock / no MediaRecorder -> on-device browser STT (it
        // auto-stops; submit() queues it when offline).
        startBrowserListen(onDone);
        return;
      }
      try {
        const stream = await recorder.begin();
        captureDoneRef.current = onDone ?? null;
        recordingModeRef.current = mode;
        setRecordingMode(mode);
        setListening(true);
        setStatus(
          mode === "ptt"
            ? "Listening… (auto-stops when you pause)"
            : "Recording… tap Stop & send when done"
        );
        if (mode === "ptt") {
          vadCleanupRef.current = attachVAD(stream, () => {
            vadCleanupRef.current = null;
            void finishCapture();
          });
        }
      } catch {
        setStatus("Microphone unavailable — using browser speech…");
        startBrowserListen(onDone);
      }
    },
    [realStt, recorder, startBrowserListen, finishCapture]
  );
  startCaptureRef.current = startCapture;

  // --- Capture-button handlers ---
  const onPushToTalk = useCallback(() => {
    if (busy) return;
    if (recordingModeRef.current === "ptt") {
      void finishCapture(); // tapped to stop early
    } else if (recordingModeRef.current === null && !listening) {
      void startCapture("ptt");
    }
  }, [busy, listening, finishCapture, startCapture]);

  const onStartRecording = useCallback(() => {
    if (busy) return;
    if (recordingModeRef.current === "manual") {
      void finishCapture(); // stop & send
    } else if (recordingModeRef.current === null && !listening) {
      void startCapture("manual");
    }
  }, [busy, listening, finishCapture, startCapture]);

  // --- Hands-free: the wake word fires a push-to-talk capture. ---
  const handleWakeRef = useRef<() => void>(() => {});

  const resumeWake = useCallback(() => {
    if (!handsFreeRef.current) return;
    setStatus('Listening for "hey field"…');
    recogRef.current = listenContinuous({
      lang: "en-IN",
      onResult: (text, isFinal) => {
        if (
          isFinal &&
          WAKE_PHRASES.some((p) => text.toLowerCase().includes(p))
        ) {
          handleWakeRef.current();
        }
      },
    });
  }, []);

  const handleWake = useCallback(() => {
    // Free the mic from the wake recognizer before recording the command.
    recogRef.current?.stop();
    recogRef.current = null;
    setStatus("Wake word heard — speak your note…");
    // Acknowledge, THEN start recording (so the "Yes?" isn't recorded).
    speak("Yes?", "en-IN", () => {
      void startCapture("ptt", resumeWake);
    });
  }, [startCapture, resumeWake]);
  handleWakeRef.current = handleWake;

  const toggleHandsFree = useCallback(() => {
    if (handsFree) {
      handsFreeRef.current = false;
      recogRef.current?.stop();
      recogRef.current = null;
      setHandsFree(false);
      setStatus("");
      return;
    }
    if (!recognitionSupported()) {
      setStatus("Hands-free needs Chrome or Edge (Web Speech).");
      return;
    }
    handsFreeRef.current = true;
    setHandsFree(true);
    resumeWake();
    setStatus('Hands-free on — say "hey field" then your note.');
  }, [handsFree, resumeWake]);

  // Stop the recognizer if the component unmounts.
  useEffect(() => () => recogRef.current?.stop(), []);

  const pttActive =
    recordingMode === "ptt" || (listening && recordingMode === null);

  return (
    <Card gold style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "18px 20px 20px" }}>
        {/* Header row: label + connectivity / hands-free / queue / sync */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <SectionLabel style={{ color: "var(--gold-2)" }}>
            Voice Capture
          </SectionLabel>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--muted)",
              }}
            >
              <span
                className={`statusdot ${online ? "statusdot--on" : "statusdot--off"}`}
              />
              {online ? "Online" : "Offline"}
            </span>
            {queued > 0 && (
              <Badge tone="amber" dot>
                {queued} queued
              </Badge>
            )}
            <button
              type="button"
              onClick={toggleHandsFree}
              aria-pressed={handsFree}
              style={{
                ...ghostBtn(false),
                borderColor: handsFree
                  ? "rgba(245,185,66,.6)"
                  : "var(--border)",
                color: handsFree ? "var(--gold-2)" : "var(--muted)",
              }}
            >
              {handsFree ? "● Hands-free on" : "Hands-free"}
            </button>
            <button
              type="button"
              onClick={flushQueue}
              disabled={!online || queued === 0}
              style={ghostBtn(!online || queued === 0)}
            >
              Sync now
            </button>
          </div>
        </div>

        {/* Capture controls: push-to-talk (VAD) + start-recording (manual) */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onPushToTalk}
            disabled={busy || recordingMode === "manual"}
            aria-pressed={pttActive}
            aria-label={pttActive ? "Listening, tap to send" : "Push to talk"}
            style={micBtn(pttActive, busy || recordingMode === "manual")}
          >
            <MicGlyph listening={pttActive} />
            <span>
              {recordingMode === "ptt"
                ? "Listening… tap to send"
                : pttActive
                  ? "Listening…"
                  : busy
                    ? "Processing…"
                    : "Push to talk"}
            </span>
          </button>
          <button
            type="button"
            onClick={onStartRecording}
            disabled={busy || pttActive}
            aria-pressed={recordingMode === "manual"}
            style={recordBtn(recordingMode === "manual", busy || pttActive)}
          >
            {recordingMode === "manual" ? "■ Stop & send" : "Start recording"}
          </button>
        </div>

        {/* Typed fallback */}
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 14,
            flexWrap: "wrap",
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit(typed)}
            aria-label="Field note"
            placeholder='Or type a note, e.g. "inverter seven low output severity high"'
            style={{ ...inputStyle, flex: "1 1 220px" }}
          />
          <button
            type="button"
            onClick={() => submit(typed)}
            disabled={busy}
            style={primaryBtn(busy)}
          >
            Send
          </button>
        </div>

        <p
          role="status"
          aria-live="polite"
          className="muted"
          style={{
            margin: status ? "12px 0 0" : 0,
            fontSize: 12.5,
            ...(status ? null : { height: 0, overflow: "hidden" }),
          }}
        >
          {status}
        </p>
      </div>

      {resp && (
        <ResponseCard
          resp={resp}
          showTrace={showTrace}
          setShowTrace={setShowTrace}
        />
      )}
    </Card>
  );
}

// ============================================================
// Response card
// ============================================================

function ResponseCard({
  resp,
  showTrace,
  setShowTrace,
}: {
  resp: VoiceResponse;
  showTrace: boolean;
  setShowTrace: (b: boolean) => void;
}) {
  const wo = resp.work_order;
  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        background: "var(--panel)",
        padding: "16px 20px 20px",
      }}
    >
      {/* Badges row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge tone="violet">{intentLabel(resp.intent)}</Badge>
          {resp.escalated && (
            <Badge tone="orange" dot>
              Escalated
            </Badge>
          )}
          {resp.needs_clarification && (
            <Badge tone="amber" dot>
              Needs info
            </Badge>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge tone={resp.mock_mode ? "muted" : "green"} dot>
            {resp.mock_mode ? "MOCK" : "LIVE"}
          </Badge>
          <Badge tone="neutral">
            <span className="mono">{resp.latency_ms} ms</span>
          </Badge>
        </div>
      </div>

      {/* Spoken reply */}
      <p
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          margin: "14px 0 0",
          fontSize: 14.5,
          lineHeight: 1.5,
          color: "var(--text)",
        }}
      >
        <span aria-hidden style={{ color: "var(--gold-2)", flexShrink: 0 }}>
          <SpeakerGlyph />
        </span>
        <span>{resp.reply}</span>
      </p>

      {/* Work order key-values */}
      {wo && (
        <div
          style={{
            marginTop: 14,
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--r-md)",
            background: "var(--panel-2)",
            padding: "12px 14px",
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "8px 16px",
            alignItems: "center",
          }}
        >
          <KvLabel>Work order</KvLabel>
          <span className="mono" style={{ fontSize: 12.5 }}>
            {wo.work_order_id ?? "—"}
          </span>

          <KvLabel>Asset</KvLabel>
          <span className="mono" style={{ fontSize: 12.5 }}>
            {wo.asset_id ?? "—"}
          </span>

          <KvLabel>Fault</KvLabel>
          <span className="mono" style={{ fontSize: 12.5 }}>
            {wo.fault_code ?? "—"}
          </span>

          <KvLabel>Severity</KvLabel>
          <span>
            <Badge tone={severityTone(wo.severity)} dot>
              {wo.severity ?? "—"}
            </Badge>
          </span>

          <KvLabel>Status</KvLabel>
          <span>
            <Badge tone={statusTone(wo.status)} dot>
              {wo.status}
            </Badge>
          </span>

          {wo.parts_required.length > 0 && (
            <>
              <KvLabel>Parts</KvLabel>
              <span style={{ fontSize: 13 }}>
                {wo.parts_required.join(", ")}
              </span>
            </>
          )}
        </div>
      )}

      {/* Sources + confidence */}
      {resp.answer_sources.length > 0 && (
        <p
          className="muted"
          style={{ margin: "12px 0 0", fontSize: 12, lineHeight: 1.5 }}
        >
          Sources: {resp.answer_sources.join(" · ")} · confidence{" "}
          {pct(resp.confidence) === "—"
            ? num(resp.confidence)
            : pct(resp.confidence)}
        </p>
      )}

      {/* Agent trace toggle */}
      <button
        type="button"
        onClick={() => setShowTrace(!showTrace)}
        style={{ ...ghostBtn(false), marginTop: 12 }}
      >
        {showTrace ? "Hide" : "Show"} agent trace
      </button>
      {showTrace && (
        <pre
          className="mono"
          style={{
            marginTop: 10,
            marginBottom: 0,
            padding: "12px 14px",
            background: "var(--panel-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--r-sm)",
            fontSize: 11.5,
            lineHeight: 1.6,
            color: "var(--muted)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowX: "auto",
          }}
        >
          {resp.trace.join("\n")}
        </pre>
      )}
    </div>
  );
}

function KvLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--muted)",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

// ============================================================
// Inline glyphs (no deps)
// ============================================================

function MicGlyph({ listening }: { listening: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={
        listening
          ? { filter: "drop-shadow(0 0 6px rgba(245,185,66,.7))" }
          : undefined
      }
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function SpeakerGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

// ============================================================
// Inline styles (token-driven; no global form CSS exists)
// ============================================================

function micBtn(listening: boolean, disabled: boolean): CSSProperties {
  return {
    appearance: "none",
    flex: "1 1 220px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: "18px 20px",
    borderRadius: "var(--r-md)",
    border: listening
      ? "1px solid rgba(245,185,66,.7)"
      : "1px solid rgba(245,185,66,.35)",
    cursor: disabled ? "default" : "pointer",
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "0.01em",
    color: listening ? "#1a1206" : "var(--gold-2)",
    background: listening
      ? "linear-gradient(135deg, var(--gold-2), var(--gold))"
      : "linear-gradient(180deg, rgba(245,185,66,.14), rgba(245,185,66,.04))",
    boxShadow: listening
      ? "0 0 0 4px rgba(245,185,66,.16), 0 12px 32px -10px rgba(245,185,66,.7)"
      : "inset 0 1px 0 rgba(255,220,150,.14), 0 10px 30px -16px rgba(245,185,66,.45)",
    opacity: disabled && !listening ? 0.7 : 1,
    transition: "all 120ms ease",
  };
}

function recordBtn(active: boolean, disabled: boolean): CSSProperties {
  return {
    appearance: "none",
    flex: "0 1 auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "18px 18px",
    borderRadius: "var(--r-md)",
    border: active ? "1px solid rgba(251,113,133,.6)" : "1px solid var(--border)",
    background: active ? "rgba(251,113,133,.14)" : "var(--panel-2)",
    color: active ? "#fb7185" : "var(--muted)",
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: "nowrap",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled && !active ? 0.5 : 1,
    transition: "all 120ms ease",
  };
}

const inputStyle: CSSProperties = {
  appearance: "none",
  minWidth: 0,
  padding: "10px 12px",
  borderRadius: "var(--r-sm)",
  border: "1px solid var(--border)",
  background: "var(--panel-2)",
  color: "var(--text)",
  fontSize: 13.5,
  fontFamily: "inherit",
  outline: "none",
};

function primaryBtn(busy: boolean): CSSProperties {
  return {
    appearance: "none",
    padding: "10px 18px",
    borderRadius: "var(--r-sm)",
    border: "1px solid transparent",
    background: "linear-gradient(135deg, var(--violet-2), var(--violet))",
    color: "#0b0712",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.7 : 1,
    transition: "opacity 120ms ease, filter 120ms ease",
    whiteSpace: "nowrap",
  };
}

function ghostBtn(disabled: boolean): CSSProperties {
  return {
    appearance: "none",
    padding: "6px 12px",
    borderRadius: "var(--r-sm)",
    border: "1px solid var(--border)",
    background: "var(--panel-2)",
    color: disabled ? "var(--faint)" : "var(--muted)",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
    transition: "color 120ms ease, border-color 120ms ease",
  };
}
