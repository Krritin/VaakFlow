"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { API_BASE } from "../lib/api";
import { logout, useSession, type Role } from "../lib/auth";

// ---- inline icons (no lucide / deps) ------------------------

function IconWorkspace() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
      <path d="M4 7.5 12 12l8-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

function IconOperations() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 4-6" />
    </svg>
  );
}

interface NavDef {
  href: string;
  label: string;
  icon: () => ReactNode;
}

const NAV_BY_ROLE: Record<Role, NavDef[]> = {
  worker: [{ href: "/workspace", label: "Workspace", icon: IconWorkspace }],
  supervisor: [{ href: "/dashboard", label: "Operations", icon: IconOperations }],
};

function isActive(pathname: string | null, href: string): boolean {
  return pathname === href || (pathname?.startsWith(href + "/") ?? false);
}

// ---- live/MOCK badge ----------------------------------------

type Conn = "checking" | "live" | "mock";

function useConnection(): Conn {
  const [conn, setConn] = useState<Conn>("checking");
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setConn("mock");
          return;
        }
        const body: unknown = await res.json().catch(() => ({}));
        const obj =
          body !== null && typeof body === "object"
            ? (body as { mock_mode?: unknown; providers?: { llm?: unknown } })
            : {};
        const mock =
          "mock_mode" in obj && typeof obj.mock_mode === "boolean"
            ? obj.mock_mode
            : obj.providers?.llm === "mock";
        setConn(mock ? "mock" : "live");
      } catch {
        if (!cancelled) setConn("mock");
      }
    };
    check();
    const id = setInterval(check, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return conn;
}

function ConnBadge({ conn }: { conn: Conn }) {
  const online = conn === "live";
  const label = conn === "checking" ? "…" : conn === "live" ? "LIVE" : "MOCK";
  const tone = conn === "live" ? "badge--green" : "badge--violet";
  return (
    <span className="badge" style={{ alignItems: "center" }} title={`API ${API_BASE}`}>
      <span className={`statusdot ${online ? "statusdot--on" : "statusdot--off"}`} />
      <span className={`badge ${tone}`} style={{ border: "none", padding: 0, background: "transparent" }}>
        {label}
      </span>
    </span>
  );
}

// ---- Brand --------------------------------------------------

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className={compact ? "topbar__brand" : "sidebar__brand"}
      style={compact ? { display: "flex" } : undefined}>
      <span className="app-logo">
        <span className="app-logo-diamond" />
      </span>
      <span>VaakFlow</span>
    </Link>
  );
}

// ---- Shell --------------------------------------------------

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const conn = useConnection();
  const { session } = useSession();

  const nav = session ? NAV_BY_ROLE[session.role] : [];

  const onLogout = () => {
    logout();
    router.push("/");
  };

  const userChip = session && (
    <div className="userchip" title={`${session.name} · ${session.role}`}>
      <span className="userchip__avatar">{session.name.charAt(0)}</span>
      <span className="userchip__meta">
        <span className="userchip__name">{session.name}</span>
        <span className="userchip__role">{session.role}</span>
      </span>
    </div>
  );

  return (
    <div className="app">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <Brand />
        <nav className="sidebar__nav" aria-label="Primary">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = isActive(pathname, n.href);
            return (
              <Link key={n.href} href={n.href}
                className={`navitem ${active ? "active" : ""}`}
                aria-current={active ? "page" : undefined}>
                <Icon />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar__spacer" />
        {userChip}
        {session && (
          <button type="button" className="logout-btn" onClick={onLogout}>
            Log out
          </button>
        )}
        <div className="sidebar__foot">
          <ConnBadge conn={conn} />
        </div>
      </aside>

      <div className="content">
        {/* Topbar — slim on desktop, full nav on mobile */}
        <header className="topbar">
          <div className="topbar__left">
            <Brand compact />
            <nav className="topbar__nav" aria-label="Mobile">
              {nav.map((n) => {
                const active = isActive(pathname, n.href);
                return (
                  <Link key={n.href} href={n.href}
                    className={`navitem ${active ? "active" : ""}`}
                    aria-current={active ? "page" : undefined}>
                    <span>{n.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ConnBadge conn={conn} />
            {session && (
              <button type="button" className="logout-btn logout-btn--compact" onClick={onLogout}>
                Log out
              </button>
            )}
          </div>
        </header>

        <main className="content__inner">{children}</main>
      </div>
    </div>
  );
}
