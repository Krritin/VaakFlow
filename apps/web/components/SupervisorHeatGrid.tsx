"use client";

// ============================================================
// VaakFlow — Supervisor site × severity heat grid (cohort matrix).
// Cell intensity scales with count. Tokens-only (violet scale).
// ============================================================

import { useMemo } from "react";
import type { WorkOrder } from "../lib/api";
import { EmptyState } from "./ui";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
type Severity = (typeof SEVERITIES)[number];

const SEV_LABEL: Record<Severity, string> = {
  low: "Low",
  medium: "Med",
  high: "High",
  critical: "Crit",
};

interface Row {
  site: string;
  cells: Record<Severity, number>;
  total: number;
}

function siteLabel(site: string): string {
  // "SITE-Bengaluru-3" -> "Bengaluru-3"
  return site.replace(/^SITE-/i, "");
}

export interface SupervisorHeatGridProps {
  orders: WorkOrder[];
  /** Optional whitelist of sites to always show (e.g. stats.by_site keys). */
  sites?: string[];
}

export function SupervisorHeatGrid({ orders, sites }: SupervisorHeatGridProps) {
  const { rows, max } = useMemo(() => {
    const map = new Map<string, Record<Severity, number>>();
    const ensure = (site: string) => {
      let r = map.get(site);
      if (!r) {
        r = { low: 0, medium: 0, high: 0, critical: 0 };
        map.set(site, r);
      }
      return r;
    };

    (sites ?? []).forEach((s) => ensure(s));

    for (const w of orders) {
      const site = w.site_id ?? "Unassigned";
      const sev = (w.severity ?? "").toLowerCase() as Severity;
      if (!SEVERITIES.includes(sev)) continue;
      ensure(site)[sev] += 1;
    }

    const built: Row[] = Array.from(map.entries()).map(([site, cells]) => ({
      site,
      cells,
      total: SEVERITIES.reduce((a, s) => a + cells[s], 0),
    }));

    built.sort((a, b) => b.total - a.total || a.site.localeCompare(b.site));

    let mx = 0;
    for (const r of built) {
      for (const s of SEVERITIES) mx = Math.max(mx, r.cells[s]);
    }
    return { rows: built, max: mx };
  }, [orders, sites]);

  if (rows.length === 0 || max === 0) {
    return (
      <EmptyState
        title="No coverage data"
        hint="Logged work orders will populate the site × severity matrix."
      />
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="heat">
        <thead>
          <tr>
            <th scope="col" className="heat__rowlabel">
              Site
            </th>
            {SEVERITIES.map((s) => (
              <th key={s} scope="col">
                {SEV_LABEL[s]}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.site}>
              <th scope="row" className="heat__rowlabel">
                {siteLabel(r.site)}
              </th>
              {SEVERITIES.map((s) => {
                const v = r.cells[s];
                const heat = max > 0 ? v / max : 0;
                return (
                  <td
                    key={s}
                    className={`heat-cell ${v === 0 ? "heat-cell--empty" : ""}`}
                    style={{ "--heat": heat } as React.CSSProperties}
                    title={`${siteLabel(r.site)} · ${SEV_LABEL[s]}: ${v}`}
                  >
                    {v === 0 ? "·" : v}
                  </td>
                );
              })}
              <td
                className="heat-cell"
                style={{ "--heat": 0 } as React.CSSProperties}
              >
                <span className="mono">{r.total}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
