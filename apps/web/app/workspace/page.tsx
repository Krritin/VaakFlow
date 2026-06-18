"use client";

// Worker Workspace — scoped to the logged-in worker. Guarded: worker role only.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getJSON,
  getStats,
  getTimeseries,
  type Stats,
  type TimeseriesResponse,
  type WorkOrder,
} from "../../lib/api";
import {
  num,
  relativeTime,
  severityLabel,
  severityTone,
  shortDate,
  statusLabel,
  statusTone,
} from "../../lib/format";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  KpiCard,
  PageHeader,
} from "../../components/ui";
import { AreaChart } from "../../components/charts";
import VoiceCapture from "../../components/VoiceCapture";
import Shell from "../../components/Shell";
import { useSession } from "../../lib/auth";

const POLL_MS = 5000;
const TIMESERIES_DAYS = 14;

export default function WorkspacePage() {
  const { session, ready } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (ready && (!session || session.role !== "worker")) {
      router.replace("/login");
    }
  }, [ready, session, router]);

  if (!ready || !session || session.role !== "worker") {
    return (
      <Shell>
        <div className="muted" style={{ padding: 24 }}>Loading…</div>
      </Shell>
    );
  }

  return (
    <Shell>
      <WorkspaceInner workerId={session.workerId} name={session.name} />
    </Shell>
  );
}

function WorkspaceInner({ workerId, name }: { workerId: string; name: string }) {
  const sessionId = `${workerId}-field`;

  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [series, setSeries] = useState<TimeseriesResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  const activeWorker = useRef(workerId);
  activeWorker.current = workerId;

  const refetch = useCallback(async (id: string) => {
    const [s, o, t] = await Promise.allSettled([
      getStats(id),
      getJSON<WorkOrder[]>(`/work_orders?worker_id=${encodeURIComponent(id)}`),
      getTimeseries(TIMESERIES_DAYS, id),
    ]);
    if (activeWorker.current !== id) return;
    if (s.status === "fulfilled") setStats(s.value);
    if (o.status === "fulfilled") setOrders(o.value);
    if (t.status === "fulfilled") setSeries(t.value);
    const allRejected =
      s.status === "rejected" && o.status === "rejected" && t.status === "rejected";
    setReconnecting(s.status === "rejected" || allRejected);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setReconnecting(false);
    setStats(null);
    setOrders(null);
    setSeries(null);
    refetch(workerId);
    const timer = setInterval(() => {
      if (!cancelled) refetch(workerId);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workerId, refetch]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const dailyCounts = series?.points.map((p) => p.count) ?? [];
  const recentOrders = (orders ?? []).slice(0, 8);

  return (
    <>
      <PageHeader
        title="Workspace"
        subtitle={`Signed in as ${name}`}
        right={
          <>
            <span
              aria-live="polite"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--muted)",
              }}
            >
              <span className={`statusdot ${online ? "statusdot--on" : "statusdot--off"}`} />
              {online ? "Online" : "Offline"}
            </span>
            {reconnecting && <Badge tone="rose" dot>Reconnecting…</Badge>}
            {queued > 0 && <Badge tone="amber" dot>{queued} queued</Badge>}
          </>
        }
      />

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <KpiCard
          label="My open WOs"
          value={loaded ? num(stats?.open) : "—"}
          sub={stats ? `${num(stats.in_progress)} in progress · ${num(stats.total)} total` : "Scoped to you"}
          accent="blue"
        />
        <KpiCard
          label="Logged today"
          value={loaded ? num(stats?.logged_today) : "—"}
          sub={stats ? `${num(stats.escalations)} escalations` : "Today's notes"}
          accent="violet"
          spark={dailyCounts.length > 1 ? dailyCounts : undefined}
        />
        <KpiCard
          label="Pending sync"
          value={num(queued)}
          sub={online ? "Queue drains on reconnect" : "Offline — saving locally"}
          accent={queued > 0 ? "amber" : "green"}
        />
        <KpiCard
          label="Total logged"
          value={loaded ? num(stats?.total) : "—"}
          sub="All your work orders"
          accent="teal"
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <VoiceCapture worker_id={workerId} session_id={sessionId} onQueueChange={setQueued} />
      </div>

      <div className="grid grid-2">
        <Card flush>
          <div style={{ padding: "18px 18px 0" }}>
            <CardHeader
              title="My recent work orders"
              sub="Captured from your voice notes"
              right={<Badge tone="muted">{num((orders ?? []).length)} total</Badge>}
            />
          </div>
          {!loaded ? (
            <div style={{ padding: "8px 0" }}>
              <EmptyState title="Loading…" />
            </div>
          ) : recentOrders.length === 0 ? (
            reconnecting ? (
              <EmptyState title="Reconnecting…" hint="Can't reach the backend. Retrying automatically." />
            ) : (
              <EmptyState title="No work orders yet" hint="Log a fault by voice or type a note above." />
            )
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Work order</th>
                    <th>Asset</th>
                    <th>Fault</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th className="num">When</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((wo, i) => (
                    <tr key={wo.work_order_id ?? `wo-${i}`}>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>{wo.work_order_id ?? "—"}</td>
                      <td className="mono">{wo.asset_id ?? "—"}</td>
                      <td><span className="mono">{wo.fault_code ?? "—"}</span></td>
                      <td><Badge tone={severityTone(wo.severity)} dot>{severityLabel(wo.severity)}</Badge></td>
                      <td><Badge tone={statusTone(wo.status)} dot>{statusLabel(wo.status)}</Badge></td>
                      <td className="num muted" style={{ whiteSpace: "nowrap" }}>{relativeTime(wo.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="My activity"
            sub={`Notes logged · last ${TIMESERIES_DAYS} days`}
            right={series ? <Badge tone="violet">{num(series.points.reduce((a, p) => a + p.count, 0))} notes</Badge> : undefined}
          />
          <AreaChart
            points={(series?.points ?? []).map((p) => ({ label: shortDate(p.date), value: p.count }))}
            color="#8b5cf6"
            height={200}
            ariaLabel={`Notes logged per day over the last ${TIMESERIES_DAYS} days`}
          />
        </Card>
      </div>
    </>
  );
}
