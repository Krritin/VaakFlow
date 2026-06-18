"use client";

// ============================================================
// VaakFlow — Supervisor Operations dashboard.
// Dark BI aesthetic. Polls every 3s. Tokens-only primitives.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getJSON,
  getStats,
  getTimeseries,
  getWorkers,
  type ActivityEvent,
  type Alert,
  type Stats,
  type TimeseriesResponse,
  type WorkerStat,
  type WorkOrder,
} from "../../lib/api";
import {
  intentLabel,
  num,
  pct,
  relativeTime,
  severityColor,
  severityTone,
  shortDate,
} from "../../lib/format";
import {
  AreaChart,
  BarChart,
  DonutChart,
  MultiLineChart,
} from "../../components/charts";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  KpiCard,
  PageHeader,
  Pill,
  SectionLabel,
  Segmented,
  Skeleton,
  StatDelta,
} from "../../components/ui";
import { WorkOrderTable } from "../../components/WorkOrderTable";
import { SupervisorHeatGrid } from "../../components/SupervisorHeatGrid";
import Shell from "../../components/Shell";
import { useRouter } from "next/navigation";
import { useSession } from "../../lib/auth";

const POLL_MS = 3000;

// ---- filter types -------------------------------------------

type SeverityFilter = "all" | "low" | "medium" | "high" | "critical";
type StatusFilter = "all" | "open" | "in_progress" | "closed";

const SEVERITY_OPTIONS: { label: string; value: SeverityFilter }[] = [
  { label: "All", value: "all" },
  { label: "Low", value: "low" },
  { label: "Med", value: "medium" },
  { label: "High", value: "high" },
  { label: "Crit", value: "critical" },
];

const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "In progress", value: "in_progress" },
  { label: "Closed", value: "closed" },
];

const DATA_COLORS = {
  violet: "#8b5cf6",
  blue: "#38bdf8",
  green: "#34d399",
  amber: "#fbbf24",
  orange: "#fb923c",
  rose: "#fb7185",
  teal: "#2dd4bf",
} as const;

const SITE_PALETTE = [
  DATA_COLORS.violet,
  DATA_COLORS.blue,
  DATA_COLORS.teal,
  DATA_COLORS.amber,
  DATA_COLORS.orange,
  DATA_COLORS.rose,
];

function siteShort(site: string): string {
  return site.replace(/^SITE-/i, "");
}

// ---- native select (tokens-only inline styling) -------------

const selectStyle: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  background:
    "var(--panel-2) url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa3b2' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>\") no-repeat right 9px center",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  padding: "6px 28px 6px 11px",
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
  minWidth: 0,
};

function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={selectStyle}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---- KPI delta from timeseries (last vs prior window) -------

function windowDelta(points: { count: number }[], half: number): number {
  if (points.length < 2) return 0;
  const n = Math.min(half, Math.floor(points.length / 2));
  if (n === 0) return 0;
  const recent = points.slice(points.length - n);
  const prior = points.slice(points.length - 2 * n, points.length - n);
  const rSum = recent.reduce((a, p) => a + p.count, 0);
  const pSum = prior.reduce((a, p) => a + p.count, 0);
  if (pSum === 0) return rSum > 0 ? 100 : 0;
  return Math.round(((rSum - pSum) / pSum) * 100);
}

// ============================================================
// Page
// ============================================================

function DashboardInner() {
  // data
  const [stats, setStats] = useState<Stats | null>(null);
  const [series, setSeries] = useState<TimeseriesResponse | null>(null);
  const [workers, setWorkers] = useState<WorkerStat[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  // status
  const [connected, setConnected] = useState(true);
  const [loaded, setLoaded] = useState(false);

  // filters
  const [site, setSite] = useState<string>("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [worker, setWorker] = useState<string>("");

  // keep latest filters available to the poll loop without re-subscribing
  const filtersRef = useRef({ site, severity, status, worker });
  filtersRef.current = { site, severity, status, worker };

  const buildWorkOrderQuery = useCallback(() => {
    const f = filtersRef.current;
    const params = new URLSearchParams();
    if (f.status !== "all") params.set("status", f.status);
    if (f.severity !== "all") params.set("severity", f.severity);
    if (f.site) params.set("site_id", f.site);
    if (f.worker) params.set("worker_id", f.worker);
    const qs = params.toString();
    return qs ? `/work_orders?${qs}` : "/work_orders";
  }, []);

  const poll = useCallback(
    async (signal?: AbortSignal) => {
      const workerId = filtersRef.current.worker || undefined;
      // Each endpoint settles independently so one failure can't blank the
      // whole dashboard. Only the core /stats request gates connection state.
      const [s, ts, wk, wo, al, act] = await Promise.allSettled([
        getStats(workerId, signal),
        getTimeseries(14, workerId, signal),
        getWorkers(signal),
        getJSON<WorkOrder[]>(buildWorkOrderQuery(), signal),
        getJSON<Alert[]>("/alerts", signal),
        getJSON<ActivityEvent[]>("/activity?limit=30", signal),
      ]);
      if (signal?.aborted) return;

      if (s.status === "fulfilled") {
        setStats(s.value);
        setConnected(true);
      } else {
        setConnected(false);
      }
      if (ts.status === "fulfilled") setSeries(ts.value);
      if (wk.status === "fulfilled") setWorkers(wk.value);
      if (wo.status === "fulfilled") setOrders(wo.value);
      if (al.status === "fulfilled") setAlerts(al.value);
      if (act.status === "fulfilled") setActivity(act.value);
      setLoaded(true);
    },
    [buildWorkOrderQuery]
  );

  // Poll loop. Re-runs immediately when filters change so the table/KPIs
  // reflect the new query without waiting for the next 3s tick.
  useEffect(() => {
    const controller = new AbortController();
    poll(controller.signal);
    const id = setInterval(() => poll(controller.signal), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [poll, site, severity, status, worker]);

  // ---- derived chart data -----------------------------------

  const areaPoints = useMemo(
    () =>
      (series?.points ?? []).map((p) => ({
        label: shortDate(p.date),
        value: p.count,
      })),
    [series]
  );

  const severitySeries = useMemo(() => {
    const pts = series?.points ?? [];
    const labels = pts.map((p) => shortDate(p.date));
    return {
      labels,
      series: [
        {
          name: "Critical",
          color: severityColor("critical"),
          values: pts.map((p) => p.critical),
        },
        {
          name: "High",
          color: severityColor("high"),
          values: pts.map((p) => p.high),
        },
        {
          name: "Medium",
          color: severityColor("medium"),
          values: pts.map((p) => p.medium),
        },
        {
          name: "Low",
          color: severityColor("low"),
          values: pts.map((p) => p.low),
        },
      ],
    };
  }, [series]);

  const severityDonut = useMemo(() => {
    const bs = stats?.by_severity;
    if (!bs) return [];
    return (
      [
        { label: "Critical", value: bs.critical, color: severityColor("critical") },
        { label: "High", value: bs.high, color: severityColor("high") },
        { label: "Medium", value: bs.medium, color: severityColor("medium") },
        { label: "Low", value: bs.low, color: severityColor("low") },
      ] as const
    ).filter((s) => s.value > 0);
  }, [stats]);

  const siteBars = useMemo(() => {
    const bySite = stats?.by_site ?? {};
    return Object.entries(bySite)
      .sort((a, b) => b[1] - a[1])
      .map(([s, v], i) => ({
        label: siteShort(s),
        value: v,
        color: SITE_PALETTE[i % SITE_PALETTE.length],
      }));
  }, [stats]);

  const siteKeys = useMemo(
    () => Object.keys(stats?.by_site ?? {}),
    [stats]
  );

  // Spark series for KPI cards. Only the Total work-orders/day headline has a
  // matching daily series, so it is the only KPI that carries a sparkline; the
  // other cards use a StatDelta with the correct direction instead (MED #12).
  const sparkTotal = useMemo(
    () => (series?.points ?? []).map((p) => p.count),
    [series]
  );

  const totalDelta = useMemo(
    () => windowDelta(series?.points ?? [], 7),
    [series]
  );

  // Critical work orders is a fault-volume trend (a rise is worse).
  const criticalDelta = useMemo(
    () =>
      windowDelta(
        (series?.points ?? []).map((p) => ({ count: p.critical })),
        7
      ),
    [series]
  );

  // worker options for the filter (workers roster is the source of truth)
  const workerOptions = useMemo(
    () => workers.map((w) => ({ value: w.worker_id, label: w.worker_id })),
    [workers]
  );

  const siteOptions = useMemo(
    () => siteKeys.map((s) => ({ value: s, label: siteShort(s) })),
    [siteKeys]
  );

  // When a worker filter is active, scope the activity feed to that worker
  // client-side (the /activity endpoint is site-wide). The Alerts panel stays
  // site-wide and is labelled as such (MED #11).
  const scopedActivity = useMemo(
    () => (worker ? activity.filter((e) => e.worker_id === worker) : activity),
    [activity, worker]
  );

  const anyFilter =
    site !== "" || severity !== "all" || status !== "all" || worker !== "";

  const clearFilters = () => {
    setSite("");
    setSeverity("all");
    setStatus("all");
    setWorker("");
  };

  // ---- render -----------------------------------------------

  const connIndicator = (
    <span
      className="pill"
      style={{
        borderColor: connected
          ? "rgba(52,211,153,0.28)"
          : "rgba(251,113,133,0.28)",
        background: connected
          ? "rgba(52,211,153,0.10)"
          : "rgba(251,113,133,0.10)",
        color: connected ? "var(--c-green)" : "var(--c-rose)",
      }}
    >
      <span
        className={`statusdot ${connected ? "statusdot--on" : "statusdot--off"}`}
      />
      {connected ? "Live" : "Reconnecting…"}
    </span>
  );

  return (
    <div>
      <PageHeader
        title="Operations"
        subtitle="Live · solar field"
        right={connIndicator}
      />

      {/* ---- Global filters ---- */}
      <Card padSm style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <SectionLabel style={{ marginRight: 2 }}>Filters</SectionLabel>

          <Segmented<StatusFilter>
            options={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
          />
          <Segmented<SeverityFilter>
            options={SEVERITY_OPTIONS}
            value={severity}
            onChange={setSeverity}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <FilterSelect
              value={site}
              onChange={setSite}
              options={siteOptions}
              allLabel="All sites"
            />
            <FilterSelect
              value={worker}
              onChange={setWorker}
              options={workerOptions}
              allLabel="All workers"
            />
          </div>

          <div style={{ flex: 1 }} />

          {anyFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="pill"
              style={{
                cursor: "pointer",
                color: "var(--violet-2)",
                borderColor: "rgba(139,92,246,0.28)",
                background: "rgba(139,92,246,0.10)",
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </Card>

      {/* ---- KPI row ---- */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {!loaded || !stats ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} style={{ minHeight: 116 }}>
              <Skeleton width={90} height={11} />
              <div style={{ height: 12 }} />
              <Skeleton width={70} height={28} />
              <div style={{ height: 12 }} />
              <Skeleton height={26} radius={8} />
            </Card>
          ))
        ) : (
          <>
            <KpiCard
              label="Total work orders"
              value={num(stats.total)}
              accent="violet"
              spark={sparkTotal}
              sub={
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {/* More work orders is a worse trend -> up reads rose. */}
                  <StatDelta value={totalDelta} goodWhenDown />
                  <span className="faint">vs prior 7d</span>
                </span>
              }
            />
            <KpiCard
              label="Open"
              value={num(stats.open)}
              accent="blue"
              sub={
                <span className="faint">
                  {num(stats.in_progress)} in progress
                </span>
              }
            />
            <KpiCard
              label="Escalations"
              value={num(stats.escalations)}
              accent="rose"
              sub={
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {/* More critical faults is a worse trend -> up reads rose. */}
                  <StatDelta value={criticalDelta} goodWhenDown />
                  <span className="faint">
                    {num(stats.critical)} critical · 7d
                  </span>
                </span>
              }
            />
            <KpiCard
              label="Closed today"
              value={num(stats.closed_today)}
              accent="green"
              sub={
                <span className="faint">
                  {num(stats.closed)} closed all-time · {pct(stats.avg_confidence)} avg conf
                </span>
              }
            />
          </>
        )}
      </div>

      {/* ---- Charts row 1: trend + donut ---- */}
      <div className="grid grid-12" style={{ marginBottom: 16 }}>
        <Card>
          <CardHeader
            title="Work orders / day"
            sub="Last 14 days"
            right={
              <Pill>
                <span
                  className="badge__dot"
                  style={{ color: DATA_COLORS.violet }}
                />
                Volume
              </Pill>
            }
          />
          {!loaded ? (
            <Skeleton height={180} radius={12} />
          ) : (
            <AreaChart
              points={areaPoints}
              color={DATA_COLORS.violet}
              height={200}
              ariaLabel="Work orders per day, last 14 days"
            />
          )}
        </Card>

        <Card>
          <CardHeader title="By severity" sub="All open + closed" />
          {!loaded ? (
            <div style={{ display: "grid", placeItems: "center", height: 200 }}>
              <Skeleton width={168} height={168} radius={999} />
            </div>
          ) : (
            <div>
              <div style={{ display: "grid", placeItems: "center" }}>
                <DonutChart
                  segments={severityDonut}
                  size={168}
                  ariaLabel="Work orders by severity"
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  justifyContent: "center",
                  marginTop: 12,
                }}
              >
                {severityDonut.map((s) => (
                  <span
                    key={s.label}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--muted)",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: s.color,
                        display: "inline-block",
                      }}
                    />
                    {s.label}
                    <span className="mono" style={{ color: "var(--text)" }}>
                      {s.value}
                    </span>
                  </span>
                ))}
                {severityDonut.length === 0 && loaded && (
                  <span className="faint" style={{ fontSize: 12 }}>
                    No severity data
                  </span>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ---- Charts row 2: severity trend + site bars ---- */}
      <div className="grid grid-12" style={{ marginBottom: 16 }}>
        <Card>
          <CardHeader
            title="Severity trend"
            sub="Daily counts by severity"
            right={
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {severitySeries.series.map((s) => (
                  <span
                    key={s.name}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 11,
                      color: "var(--muted)",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: s.color,
                        display: "inline-block",
                      }}
                    />
                    {s.name}
                  </span>
                ))}
              </div>
            }
          />
          {!loaded ? (
            <Skeleton height={200} radius={12} />
          ) : (
            <MultiLineChart
              series={severitySeries.series}
              labels={severitySeries.labels}
              height={200}
              ariaLabel="Daily work order counts by severity, last 14 days"
            />
          )}
        </Card>

        <Card>
          <CardHeader title="By site" sub="Work order volume" />
          {!loaded ? (
            <Skeleton height={200} radius={12} />
          ) : siteBars.length === 0 ? (
            <EmptyState title="No site data" />
          ) : (
            <BarChart
              data={siteBars}
              height={200}
              ariaLabel="Work order volume by site"
            />
          )}
        </Card>
      </div>

      {/* ---- Heat grid: site × severity ---- */}
      <Card style={{ marginBottom: 16 }}>
        <CardHeader
          title="Site × severity coverage"
          sub="Cell intensity scales with work-order count"
        />
        {!loaded ? (
          <Skeleton height={160} radius={12} />
        ) : (
          <SupervisorHeatGrid orders={orders} sites={siteKeys} />
        )}
      </Card>

      {/* ---- Escalation alerts (hero, gold glow) ---- */}
      <Card gold style={{ marginBottom: 16 }}>
        <CardHeader
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  background: "rgba(245,185,66,0.15)",
                  color: "var(--gold-2)",
                }}
                aria-hidden
              >
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
              </span>
              <span className="text-gold">Escalation alerts</span>
            </span>
          }
          sub="Site-wide critical faults requiring supervisor attention"
          right={
            <Badge tone={alerts.length > 0 ? "rose" : "muted"} dot>
              {alerts.length} active
            </Badge>
          }
        />
        {!loaded ? (
          <Skeleton height={60} radius={10} />
        ) : alerts.length === 0 ? (
          <EmptyState title="No active escalations" hint="All critical faults are handled." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  borderLeft: `3px solid ${severityColor(a.severity)}`,
                }}
              >
                <Badge tone={severityTone(a.severity)} dot>
                  {a.severity.toUpperCase()}
                </Badge>
                <span style={{ flex: 1, minWidth: 0 }}>{a.message}</span>
                {a.work_order_id && (
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {a.work_order_id}
                  </span>
                )}
                <span className="faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {relativeTime(a.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---- Work order table ---- */}
      <Card flush style={{ marginBottom: 16 }}>
        <div style={{ padding: "18px 18px 0" }}>
          <CardHeader
            title="Work orders"
            sub={loaded ? `${num(orders.length)} matching` : "Loading…"}
            right={
              anyFilter ? (
                <Badge tone="violet" dot>
                  Filtered
                </Badge>
              ) : undefined
            }
          />
        </div>
        <WorkOrderTable orders={orders} loading={!loaded} onChanged={() => poll()} />
      </Card>

      {/* ---- Worker roster + activity feed ---- */}
      <div className="grid grid-12" style={{ marginBottom: 8 }}>
        <Card flush>
          <div style={{ padding: "18px 18px 0" }}>
            <CardHeader
              title="Worker roster"
              sub={`${num(stats?.active_workers ?? workers.length)} active`}
            />
          </div>
          {!loaded ? (
            <div style={{ padding: 16 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} height={18} style={{ marginBottom: 12 }} />
              ))}
            </div>
          ) : workers.length === 0 ? (
            <EmptyState title="No workers yet" />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th className="num">Total</th>
                    <th className="num">Open</th>
                    <th className="num">Escalations</th>
                    <th className="num">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w) => {
                    const active = worker === w.worker_id;
                    const toggle = () =>
                      setWorker((cur) =>
                        cur === w.worker_id ? "" : w.worker_id
                      );
                    return (
                      <tr
                        key={w.worker_id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={active}
                        aria-label={`${
                          active ? "Clear filter for" : "Filter by"
                        } worker ${w.worker_id}`}
                        onClick={toggle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle();
                          }
                        }}
                        style={{
                          cursor: "pointer",
                          background: active ? "var(--panel-2)" : undefined,
                        }}
                      >
                        <td>
                          <span
                            className="mono"
                            style={{
                              color: active ? "var(--violet-2)" : "var(--text)",
                            }}
                          >
                            {w.worker_id}
                          </span>
                        </td>
                        <td className="num mono">{num(w.total)}</td>
                        <td className="num mono">{num(w.open)}</td>
                        <td className="num">
                          {w.escalations > 0 ? (
                            <Badge tone="rose">{num(w.escalations)}</Badge>
                          ) : (
                            <span className="faint mono">0</span>
                          )}
                        </td>
                        <td className="num muted" style={{ whiteSpace: "nowrap" }}>
                          {relativeTime(w.last_active)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Activity feed"
            sub={
              worker
                ? `Latest voice captures · ${worker}`
                : "Latest voice captures"
            }
            right={<Pill>{num(scopedActivity.length)}</Pill>}
          />
          {!loaded ? (
            <div>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} height={18} style={{ marginBottom: 12 }} />
              ))}
            </div>
          ) : scopedActivity.length === 0 ? (
            <EmptyState
              title="No activity yet"
              hint={
                worker
                  ? `No recent captures for ${worker}.`
                  : "Voice captures will appear here."
              }
            />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                maxHeight: 460,
                overflowY: "auto",
              }}
            >
              {scopedActivity.map((e, i) => (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    gap: 11,
                    padding: "11px 0",
                    borderBottom:
                      i === scopedActivity.length - 1
                        ? "none"
                        : "1px solid var(--border-soft)",
                  }}
                >
                  <div style={{ flex: "0 0 auto", paddingTop: 2 }}>
                    <Badge tone="violet">{intentLabel(e.kind)}</Badge>
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span className="mono muted" style={{ fontSize: 11.5 }}>
                        {e.worker_id}
                      </span>
                      <span className="faint" style={{ fontSize: 11 }}>
                        {relativeTime(e.created_at)}
                      </span>
                    </div>
                    <ConversationThread transcript={e.transcript} summary={e.summary} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { session, ready } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (ready && (!session || session.role !== "supervisor")) {
      router.replace("/login");
    }
  }, [ready, session, router]);

  if (!ready || !session || session.role !== "supervisor") {
    return (
      <Shell>
        <div className="muted" style={{ padding: 24 }}>Loading…</div>
      </Shell>
    );
  }
  return (
    <Shell>
      <DashboardInner />
    </Shell>
  );
}

// ---- Activity feed: render a stored transcript as a chat thread ----
type ChatMsg = { role: "user" | "assistant"; text: string };

function parseConversation(transcript?: string | null, summary?: string): ChatMsg[] {
  const msgs: ChatMsg[] = [];
  const lines = (transcript || "").split("\n").map((l) => l.trim()).filter(Boolean);
  let labeled = false;
  for (const line of lines) {
    if (/^worker:/i.test(line)) {
      msgs.push({ role: "user", text: line.replace(/^worker:/i, "").trim() });
      labeled = true;
    } else if (/^vaakflow:/i.test(line)) {
      msgs.push({ role: "assistant", text: line.replace(/^vaakflow:/i, "").trim() });
      labeled = true;
    } else if (labeled && msgs.length) {
      msgs[msgs.length - 1].text += " " + line;
    }
  }
  if (!labeled) {
    if (transcript && transcript.trim()) msgs.push({ role: "user", text: transcript.trim() });
    if (summary && summary.trim()) msgs.push({ role: "assistant", text: summary.trim() });
  }
  return msgs;
}

function isSystemAction(text: string): boolean {
  return /\b(work order|wo-\d|created|closed|reopened|updated|escalated|alerted)\b/i.test(text);
}

function ConversationThread({
  transcript,
  summary,
}: {
  transcript?: string | null;
  summary?: string;
}) {
  const msgs = parseConversation(transcript, summary);
  if (!msgs.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      {msgs.map((m, i) => {
        const isUser = m.role === "user";
        const sys = !isUser && isSystemAction(m.text);
        const label = isUser ? "User" : sys ? "System" : "VaakFlow";
        const color = isUser ? "var(--muted)" : sys ? "#34d399" : "#a78bfa";
        const bg = isUser
          ? "var(--panel-2)"
          : sys
            ? "rgba(52,211,153,0.10)"
            : "rgba(139,92,246,0.12)";
        const border = isUser
          ? "1px solid var(--border)"
          : sys
            ? "1px solid rgba(52,211,153,0.30)"
            : "1px solid rgba(139,92,246,0.30)";
        // System actions read cleaner as bullets (one per sentence).
        const bullets =
          sys && /[.!]\s/.test(m.text)
            ? m.text
                .split(/(?<=[.!])\s+/)
                .map((b) => b.replace(/[.\s]+$/, "").trim())
                .filter(Boolean)
            : null;
        return (
          <div
            key={i}
            style={{
              alignSelf: isUser ? "flex-start" : "flex-end",
              maxWidth: "90%",
              background: bg,
              border,
              borderRadius: 10,
              padding: "7px 10px",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color,
                marginBottom: 2,
              }}
            >
              {label}
            </div>
            {bullets && bullets.length > 1 ? (
              <ul
                className="mono"
                style={{
                  margin: 0,
                  paddingLeft: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "var(--text)",
                }}
              >
                {bullets.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            ) : (
              <div className="mono" style={{ fontSize: 12, lineHeight: 1.45, color: "var(--text)" }}>
                {m.text}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
