"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, homeFor, type Role } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("worker");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const session = login(role, id, password);
    if (!session) {
      setError("Invalid ID or password for the selected role.");
      return;
    }
    router.push(homeFor(session.role));
  };

  return (
    <div className="lgn-root">
      {/* Ambient background — matches the landing aesthetic */}
      <div className="lgn-grid" />
      <div className="lgn-glow lgn-glow--blue" />
      <div className="lgn-glow lgn-glow--purple" />
      <div className="lgn-watermark" aria-hidden>VaakFlow</div>

      {/* Faded "living" mock components — full opacity on hover */}
      <div className="lgn-float lgn-float--tl">
        <span className="lgn-float-label" style={{ color: "#60a5fa" }}>
          <span className="lgn-pulse" /> Live transcript
        </span>
        <p className="lgn-mono">“inverter seven, string two, low output…”</p>
      </div>

      <div className="lgn-float lgn-float--tr">
        <span className="lgn-float-label" style={{ color: "#34d399" }}>✓ Work order</span>
        <div className="lgn-mono lgn-wo">WO-1042 · INV-07</div>
        <div className="lgn-chips">
          <span className="lgn-chip lgn-chip--orange">high</span>
          <span className="lgn-chip lgn-chip--blue">open</span>
        </div>
      </div>

      <div className="lgn-float lgn-float--bl">
        <span className="lgn-float-label" style={{ color: "#fb7185" }}>⚠ Escalation</span>
        <p className="lgn-mono" style={{ color: "#fda4af" }}>
          CRITICAL · INV-12 — ground fault
        </p>
      </div>

      <div className="lgn-float lgn-float--br">
        <span className="lgn-float-label">Open work orders</span>
        <div className="lgn-kpi-row">
          <span className="lgn-kpi-val">36</span>
          <svg width="84" height="28" viewBox="0 0 84 28" className="lgn-spark" aria-hidden>
            <polyline points="0,22 12,18 24,20 36,12 48,15 60,7 72,10 84,4"
              fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <div className="lgn-float lgn-float--lc">
        <span className="lgn-float-label" style={{ color: "#ffd479" }}>🎙 Hands-free</span>
        <p className="lgn-mono">“hey field…”</p>
      </div>

      <div className="lgn-float lgn-float--rc">
        <span className="lgn-float-label" style={{ color: "#60a5fa" }}>{"{ }"} Extract</span>
        <pre className="lgn-json">{`{
  "asset": "INV-07",
  "fault": "INV-LOWOUT",
  "severity": "high"
}`}</pre>
      </div>

      {/* Login card (upright) over a rotated gradient panel */}
      <div className="lgn-cardwrap">
      <div className="lgn-card-back" aria-hidden />
      <div className="lgn-card">
        <div className="lgn-card-grid">
        <div className="lgn-col">
        <Link href="/" className="lgn-brand">
          <span className="lgn-logo"><span className="lgn-logo-diamond" /></span>
          <span>VaakFlow</span>
        </Link>

        <h1 className="lgn-title">Welcome back</h1>
        <p className="lgn-sub">Sign in to your field operations workspace.</p>

        <div className="lgn-roles" role="radiogroup" aria-label="Login as">
          <button
            type="button"
            role="radio"
            aria-checked={role === "worker"}
            className={`lgn-role ${role === "worker" ? "active" : ""}`}
            onClick={() => { setRole("worker"); setError(""); }}
          >
            <RoleIconWorker />
            <span>Login as Worker</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={role === "supervisor"}
            className={`lgn-role ${role === "supervisor" ? "active" : ""}`}
            onClick={() => { setRole("supervisor"); setError(""); }}
          >
            <RoleIconSupervisor />
            <span>Login as Supervisor</span>
          </button>
        </div>
        </div>

        <div className="lgn-col">
        <form onSubmit={submit} className="lgn-form">
          <label className="lgn-field">
            <span>ID</span>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              inputMode="numeric"
              autoComplete="username"
              placeholder={role === "supervisor" ? "999" : "1001"}
              className="mono"
            />
          </label>
          <label className="lgn-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••"
              className="mono"
            />
          </label>

          {error && <p className="lgn-error">{error}</p>}

          <button type="submit" className="lgn-submit">
            Log in as {role === "supervisor" ? "Supervisor" : "Worker"}
          </button>
        </form>

        <div className="lgn-hint">
          <span className="lgn-hint-title">Demo credentials</span>
          {role === "worker" ? (
            <ul>
              <li>Krritin — <code>1001</code> / <code>1001</code></li>
              <li>Shlok <code>1002</code> · Navjeet <code>1003</code></li>
              <li>Krishaank <code>1004</code> · Yuvraj <code>1005</code></li>
              <li className="lgn-faint">(password is the same as the ID)</li>
            </ul>
          ) : (
            <ul>
              <li>Supervisor — <code>999</code> / <code>999</code></li>
              <li className="lgn-faint">Full access to the operations dashboard.</li>
            </ul>
          )}
        </div>
        </div>
        </div>
      </div>
      </div>
    </div>
  );
}

function RoleIconWorker() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2 3 6v6c0 5 3.8 8.4 9 10 5.2-1.6 9-5 9-10V6l-9-4Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function RoleIconSupervisor() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 4-6" />
    </svg>
  );
}
