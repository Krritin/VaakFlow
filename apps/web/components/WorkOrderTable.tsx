"use client";

// ============================================================
// VaakFlow — Supervisor work-order table (sortable, filtered).
// Owned by the Operations dashboard. Tokens-only.
// ============================================================

import { useMemo, useState } from "react";
import { setWorkOrderStatus, type WorkOrder } from "../lib/api";
import {
  relativeTime,
  severityTone,
  statusTone,
} from "../lib/format";
import { Badge, EmptyState } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  open: "#38bdf8",
  in_progress: "#a78bfa",
  closed: "#34d399",
};

function StatusSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: "open" | "in_progress" | "closed") => void;
}) {
  const color = STATUS_COLOR[value] ?? "var(--muted)";
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <select
        value={value}
        onChange={(e) =>
          onChange(e.target.value as "open" | "in_progress" | "closed")
        }
        aria-label="Change work order status"
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          background: "var(--panel-2)",
          color,
          border: `1px solid ${color}55`,
          borderRadius: 999,
          padding: "3px 24px 3px 11px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="open">Open</option>
        <option value="in_progress">In progress</option>
        <option value="closed">Closed</option>
      </select>
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 9,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          fontSize: 8,
          color: "var(--muted)",
        }}
      >
        ▾
      </span>
    </span>
  );
}

export type WoSortKey = "time" | "severity";
export type WoSortDir = "asc" | "desc";

// Higher = more severe — used for severity sort.
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function severityRank(sev: string | null | undefined): number {
  return SEVERITY_RANK[(sev ?? "").toLowerCase()] ?? 0;
}

function createdMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function statusLabel(status: string | null | undefined): string {
  const k = (status ?? "").toLowerCase();
  if (k === "in_progress" || k === "in-progress") return "In progress";
  if (!k) return "—";
  return k.charAt(0).toUpperCase() + k.slice(1);
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: WoSortDir;
  onClick: () => void;
  align?: "right";
}) {
  const ariaSort: "ascending" | "descending" | "none" = active
    ? dir === "desc"
      ? "descending"
      : "ascending"
    : "none";
  const dirWord = active
    ? dir === "desc"
      ? "descending"
      : "ascending"
    : "unsorted";
  return (
    <th className={align === "right" ? "num" : undefined} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={onClick}
        aria-label={`Sort by ${label}, currently ${dirWord}`}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          font: "inherit",
          color: active ? "var(--text)" : "var(--muted)",
          cursor: "pointer",
          padding: 0,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: 11,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {label}
        <span aria-hidden style={{ fontSize: 8, opacity: active ? 1 : 0.35 }}>
          {active ? (dir === "desc" ? "▼" : "▲") : "▾"}
        </span>
      </button>
    </th>
  );
}

export interface WorkOrderTableProps {
  orders: WorkOrder[];
  loading?: boolean;
  onChanged?: () => void;
}

export function WorkOrderTable({ orders, loading, onChanged }: WorkOrderTableProps) {
  const [sortKey, setSortKey] = useState<WoSortKey>("time");
  const [sortDir, setSortDir] = useState<WoSortDir>("desc");
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const changeStatus = (
    id: string,
    status: "open" | "in_progress" | "closed"
  ) => {
    setOverrides((o) => ({ ...o, [id]: status })); // optimistic
    setWorkOrderStatus(id, status)
      .then(() => onChanged?.())
      .catch(() => {});
  };

  const setSort = (key: WoSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => {
    const arr = [...orders];
    const factor = sortDir === "desc" ? -1 : 1;
    arr.sort((a, b) => {
      if (sortKey === "severity") {
        const d = severityRank(a.severity) - severityRank(b.severity);
        if (d !== 0) return d * factor;
        // tie-break newest first within a severity bucket
        return (createdMs(b.created_at) - createdMs(a.created_at));
      }
      return (createdMs(a.created_at) - createdMs(b.created_at)) * factor;
    });
    return arr;
  }, [orders, sortKey, sortDir]);

  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              padding: "11px 0",
              borderBottom: "1px solid var(--border-soft)",
            }}
          >
            <div className="skeleton" style={{ width: 90, height: 14 }} />
            <div className="skeleton" style={{ width: 120, height: 14 }} />
            <div className="skeleton" style={{ flex: 1, height: 14 }} />
            <div className="skeleton" style={{ width: 70, height: 14 }} />
          </div>
        ))}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <EmptyState
        title="No work orders"
        hint="Nothing matches the current filters. Try clearing site, severity, status or worker."
      />
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>Work order</th>
            <th>Asset</th>
            <th>Fault</th>
            <SortHeader
              label="Severity"
              active={sortKey === "severity"}
              dir={sortDir}
              onClick={() => setSort("severity")}
            />
            <th>Status</th>
            <th>Worker</th>
            <SortHeader
              label="Logged"
              active={sortKey === "time"}
              dir={sortDir}
              onClick={() => setSort("time")}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((w, i) => {
            const sev = (w.severity ?? "").toLowerCase();
            return (
              <tr key={w.work_order_id ?? `wo-${i}`}>
                <td>
                  <span className="mono" style={{ color: "var(--violet-2)" }}>
                    {w.work_order_id ?? "—"}
                  </span>
                </td>
                <td>
                  <span className="mono">{w.asset_id ?? "—"}</span>
                  {w.location && (
                    <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
                      {w.location}
                    </div>
                  )}
                </td>
                <td>
                  {w.fault_code ? (
                    <span className="mono">{w.fault_code}</span>
                  ) : (
                    <span className="faint">{w.inspection_result ?? "—"}</span>
                  )}
                </td>
                <td>
                  <Badge tone={severityTone(w.severity)} dot>
                    {sev ? sev.charAt(0).toUpperCase() + sev.slice(1) : "—"}
                  </Badge>
                </td>
                <td>
                  {w.work_order_id ? (
                    <StatusSelect
                      value={overrides[w.work_order_id] ?? w.status}
                      onChange={(s) => changeStatus(w.work_order_id as string, s)}
                    />
                  ) : (
                    <Badge tone={statusTone(w.status)} dot>
                      {statusLabel(w.status)}
                    </Badge>
                  )}
                </td>
                <td>
                  <span className="mono muted">{w.worker_id}</span>
                </td>
                <td className="num">
                  <span className="muted" title={w.created_at ?? undefined}>
                    {relativeTime(w.created_at)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
