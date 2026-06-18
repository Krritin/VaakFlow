// ============================================================
// VaakFlow — formatting + design-token mapping helpers
// ============================================================

export type Tone =
  | "violet"
  | "blue"
  | "green"
  | "amber"
  | "orange"
  | "rose"
  | "teal"
  | "muted"
  | "neutral";

/** Map a severity value to a Badge/pill tone. */
export function severityTone(sev: string | null | undefined): Tone {
  switch ((sev ?? "").toLowerCase()) {
    case "low":
      return "green";
    case "medium":
      return "amber";
    case "high":
      return "orange";
    case "critical":
      return "rose";
    default:
      return "muted";
  }
}

/** Map a severity value to a raw hex data color (for charts / dots). */
export function severityColor(sev: string | null | undefined): string {
  switch ((sev ?? "").toLowerCase()) {
    case "low":
      return "#34d399"; // --c-green
    case "medium":
      return "#fbbf24"; // --c-amber
    case "high":
      return "#fb923c"; // --c-orange
    case "critical":
      return "#fb7185"; // --c-rose
    default:
      return "#9aa3b2"; // --muted
  }
}

/** Map a work-order status to a Badge/pill tone. */
export function statusTone(status: string | null | undefined): Tone {
  switch ((status ?? "").toLowerCase()) {
    case "open":
      return "blue";
    case "in_progress":
    case "in-progress":
      return "violet";
    case "closed":
    case "resolved":
    case "done":
      return "green";
    default:
      return "muted";
  }
}

/** Human label for an intent code. */
export function intentLabel(intent: string | null | undefined): string {
  const key = (intent ?? "").toLowerCase();
  const map: Record<string, string> = {
    log_fault: "Log Fault",
    create_work_order: "Work Order",
    work_order: "Work Order",
    inspection: "Inspection",
    question: "Question",
    query: "Query",
    status: "Status",
    update: "Update",
    escalate: "Escalation",
    escalation: "Escalation",
    clarify: "Needs Info",
    clarification: "Needs Info",
    unknown: "Unknown",
    chitchat: "Chitchat",
    greeting: "Greeting",
  };
  if (map[key]) return map[key];
  if (!key) return "—";
  // Fallback: prettify snake_case -> Title Case
  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Human label for a work-order status. */
export function statusLabel(status: string): string {
  if (status === "in_progress") return "In progress";
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Human label for a severity value. "—" when falsy. */
export function severityLabel(sev?: string | null): string {
  if (!sev) return "—";
  return sev
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Relative "time ago" from an ISO timestamp. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 0) {
    // future — small clock skew tolerance
    if (sec > -60) return "just now";
  }
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(day / 365);
  return `${yr}y ago`;
}

/** Format an integer/number with grouping. NaN/null safe. */
export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US");
}

/** Format a 0..1 fraction as a percentage string. */
export function pct(n01: number | null | undefined): string {
  if (n01 === null || n01 === undefined || Number.isNaN(n01)) return "—";
  return `${Math.round(n01 * 100)}%`;
}

/** Short date label e.g. "Jun 16". Returns "—" on bad input. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
