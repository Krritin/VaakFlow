"use client";

// Demo auth — NOT real security. Client-side session in localStorage so the
// presentation can show role-based access (worker vs supervisor). Password == id.

import { useEffect, useState } from "react";

export type Role = "worker" | "supervisor";

export interface Session {
  role: Role;
  workerId: string; // backend worker_id (e.g. "krritin") or "supervisor"
  name: string;
}

const KEY = "vaakflow_session";

// id -> { backend worker_id, display name }. Password is the same as the id.
const WORKERS: Record<string, { workerId: string; name: string }> = {
  "1001": { workerId: "krritin", name: "Krritin" },
  "1002": { workerId: "shlok", name: "Shlok" },
  "1003": { workerId: "navjeet", name: "Navjeet" },
  "1004": { workerId: "krishaank", name: "Krishaank" },
  "1005": { workerId: "yuvraj", name: "Yuvraj" },
};

const SUPERVISORS: Record<string, { name: string }> = {
  "999": { name: "Supervisor" },
};

function persist(s: Session): void {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function logout(): void {
  if (typeof window !== "undefined") localStorage.removeItem(KEY);
}

/** Validate demo credentials. Returns a Session on success, else null. */
export function login(role: Role, id: string, password: string): Session | null {
  const uid = id.trim();
  const pass = password.trim();
  if (role === "worker") {
    const w = WORKERS[uid];
    if (w && pass === uid) {
      const s: Session = { role, workerId: w.workerId, name: w.name };
      persist(s);
      return s;
    }
  } else {
    const sup = SUPERVISORS[uid];
    if (sup && pass === uid) {
      const s: Session = { role, workerId: "supervisor", name: sup.name };
      persist(s);
      return s;
    }
  }
  return null;
}

/** Where each role lands after login. */
export function homeFor(role: Role): string {
  return role === "supervisor" ? "/dashboard" : "/workspace";
}

/**
 * Read the session after mount. `ready` is false during SSR / first paint
 * (localStorage unavailable), so guards can avoid a redirect flash.
 */
export function useSession(): { session: Session | null; ready: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setSession(getSession());
    setReady(true);
  }, []);
  return { session, ready };
}
