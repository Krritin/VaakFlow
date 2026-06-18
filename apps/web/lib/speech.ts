// Thin wrapper over the browser Web Speech API (free, on-device STT + TTS).
// SpeechRecognition is webkit-prefixed and not in standard DOM types -> any.

export function recognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function synthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export interface Listener {
  stop: () => void;
}

export function listenOnce(opts: {
  lang?: string;
  onResult: (text: string) => void;
  onError?: (err: string) => void;
  onEnd?: () => void;
}): Listener {
  const w = window as any;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  const rec = new Ctor();
  rec.lang = opts.lang || "en-IN";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  rec.onresult = (e: any) => opts.onResult(e.results[0][0].transcript);
  rec.onerror = (e: any) => opts.onError?.(e.error || "speech-error");
  rec.onend = () => opts.onEnd?.();
  rec.start();
  return { stop: () => rec.stop() };
}

export function speak(text: string, lang = "en-IN", onEnd?: () => void): void {
  if (!synthesisSupported() || !text) {
    onEnd?.();
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1.02;
  if (onEnd) {
    u.onend = () => onEnd();
    u.onerror = () => onEnd();
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// Continuous recognition for hands-free / wake-word mode. Emits each result
// (interim + final) and auto-restarts when the browser ends the session
// (Web Speech stops after pauses). Call stop() to end for good.
export interface ContinuousListener {
  stop: () => void;
}

export function listenContinuous(opts: {
  lang?: string;
  onResult: (text: string, isFinal: boolean) => void;
  onError?: (err: string) => void;
}): ContinuousListener {
  const w = window as any;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  const rec = new Ctor();
  rec.lang = opts.lang || "en-IN";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let stopped = false;
  rec.onresult = (e: any) => {
    const r = e.results[e.results.length - 1];
    opts.onResult(r[0].transcript, r.isFinal);
  };
  rec.onerror = (e: any) => opts.onError?.(e.error || "speech-error");
  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start();
      } catch {
        /* already starting */
      }
    }
  };
  rec.start();
  return {
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
