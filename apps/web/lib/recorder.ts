"use client";

// Microphone recorder backed by MediaRecorder (webm/opus). Captures a single
// utterance to a Blob suitable for POST /transcribe (Groq Whisper). SSR-safe:
// nothing touches `window`/`navigator` until a method is called in the browser.
//
//   const rec = useRecorder();
//   await rec.begin();          // prompts for mic, starts recording
//   const blob = await rec.end(); // stops, returns the recorded audio Blob

import { useCallback, useEffect, useRef } from "react";

/** True only in a browser that exposes getUserMedia + MediaRecorder. */
export function recorderSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== "undefined"
  );
}

/** Pick the best webm/opus mime the browser will record, else "". */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported may throw in some browsers */
    }
  }
  return "";
}

export interface Recorder {
  /** Whether this browser can record at all (getUserMedia + MediaRecorder). */
  supported: () => boolean;
  /** Whether a recording is currently in progress. */
  recording: () => boolean;
  /** Acquire the mic and start recording. Resolves with the live MediaStream. */
  begin: () => Promise<MediaStream>;
  /** Stop recording and resolve with the captured audio Blob. */
  end: () => Promise<Blob>;
  /** Best-effort teardown (stop tracks); safe to call any time. */
  cancel: () => void;
}

export function useRecorder(): Recorder {
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    const mr = mediaRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* already stopped */
      }
    }
    mediaRef.current = null;
    chunksRef.current = [];
    stopTracks();
  }, [stopTracks]);

  // Release the mic if the component unmounts mid-recording.
  useEffect(() => () => cancel(), [cancel]);

  const supported = useCallback(() => recorderSupported(), []);

  const recording = useCallback(
    () => mediaRef.current?.state === "recording",
    []
  );

  const begin = useCallback(async (): Promise<MediaStream> => {
    if (!recorderSupported()) {
      throw new Error("MediaRecorder not supported");
    }
    // Clean up any prior session before starting a new one.
    cancel();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    const mimeType = pickMimeType();
    const mr = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mediaRef.current = mr;
    mr.start();
    return stream;
  }, [cancel]);

  const end = useCallback(async (): Promise<Blob> => {
    const mr = mediaRef.current;
    if (!mr) throw new Error("Not recording");

    const blob = await new Promise<Blob>((resolve, reject) => {
      mr.onstop = () => {
        const type = mr.mimeType || "audio/webm";
        resolve(new Blob(chunksRef.current, { type }));
      };
      mr.onerror = () => reject(new Error("recording-error"));
      if (mr.state !== "inactive") {
        try {
          mr.stop();
        } catch (err) {
          reject(err as Error);
        }
      } else {
        const type = mr.mimeType || "audio/webm";
        resolve(new Blob(chunksRef.current, { type }));
      }
    });

    mediaRef.current = null;
    chunksRef.current = [];
    stopTracks();
    return blob;
  }, [stopTracks]);

  return { supported, recording, begin, end, cancel };
}

// Voice-activity detection: watch a live mic stream and call `onSilence` once
// the speaker has talked and then gone quiet for `silenceMs` (so a recording can
// auto-stop without a second tap). Also fires after `maxMs` as a safety cap.
// Returns a cleanup function (call it if you stop early). Browser-only.
export function attachVAD(
  stream: MediaStream,
  onSilence: () => void,
  { silenceMs = 1400, threshold = 0.015, maxMs = 15000 } = {}
): () => void {
  const AudioCtx =
    typeof window !== "undefined"
      ? window.AudioContext || (window as any).webkitAudioContext
      : undefined;
  if (!AudioCtx) return () => {};

  const ctx: AudioContext = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  let started = false; // only auto-stop after we've heard actual speech
  let silentSince = performance.now();
  const startedAt = performance.now();
  let raf = 0;
  let done = false;

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    ctx.close().catch(() => {});
  };

  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();

    if (rms > threshold) {
      started = true;
      silentSince = now;
    }
    const quietLongEnough = started && now - silentSince > silenceMs;
    const tooLong = now - startedAt > maxMs;
    if ((quietLongEnough || tooLong) && !done) {
      done = true;
      cleanup();
      onSilence();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return cleanup;
}
