"use client";

// ============================================================
// VaakFlow — pure inline-SVG chart library. No deps.
// Charts measure their container and render at true pixel width
// (1 user unit = 1px) so strokes, dots and axis text never distort
// under non-uniform scaling. Tokens-only colors.
// ============================================================

import { useEffect, useId, useRef, useState } from "react";

/**
 * Measure the chart container's content-box width via ResizeObserver.
 * Returns a ref to attach to the wrapper plus the current pixel width.
 * Charts render their viewBox at this width so 1 user unit == 1 CSS px,
 * keeping geometry proportional at any size (no preserveAspectRatio hacks).
 * SSR-safe: starts at `fallback` (~600) until the element is measured.
 */
function useMeasuredWidth(
  fallback = 600
): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Data series colors — mirror the --c-* tokens in app/globals.css.
const C = {
  violet: "#8b5cf6", // --c-violet
  blue: "#38bdf8", // --c-blue
  green: "#34d399", // --c-green
  amber: "#fbbf24", // --c-amber
  orange: "#fb923c", // --c-orange
  rose: "#fb7185", // --c-rose
  teal: "#2dd4bf", // --c-teal
};

const GRID = "#161a22"; // --grid (chart gridline)
const TEXT = "#eef1f7"; // --text (primary, donut total)
// Axis / label text color. Brightened from the old #646b7a (which is the
// dim --faint token, ~3.7:1 on --panel and below WCAG AA) to #9aa3b2, the
// --muted token (~4.7:1 on --panel) so small (~11px) labels stay legible.
const FAINT = "#9aa3b2"; // --muted

// ---- math helpers -------------------------------------------------

function range(min: number, max: number, count: number): number[] {
  if (count <= 1) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

/**
 * Build a smooth (Catmull-Rom -> cubic Bezier) SVG path through points.
 * Monotone-ish smoothing with bounded tension; never overshoots wildly.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const t = 0.2; // tension
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + ((p2.x - p0.x) * t) / 1;
    const c1y = p1.y + ((p2.y - p0.y) * t) / 1;
    const c2x = p2.x - ((p3.x - p1.x) * t) / 1;
    const c2y = p2.y - ((p3.y - p1.y) * t) / 1;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(
      2
    )}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

/**
 * Accessibility props for an SVG chart: when an ariaLabel is given the SVG
 * is exposed as role="img" with a <title>; otherwise it is hidden from AT.
 */
function a11y(ariaLabel?: string): {
  role: "img";
  "aria-hidden"?: true;
} {
  return ariaLabel ? { role: "img" } : { role: "img", "aria-hidden": true };
}

// ============================================================
// AreaChart
// ============================================================

export interface AreaChartProps {
  points: { label: string; value: number }[];
  color?: string;
  height?: number;
  ariaLabel?: string;
}

export function AreaChart({
  points,
  color = C.violet,
  height = 180,
  ariaLabel,
}: AreaChartProps) {
  const uid = useId().replace(/:/g, "");
  const [ref, W] = useMeasuredWidth();
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 22;

  if (points.length === 0) {
    return <EmptyChart height={height} />;
  }

  const values = points.map((p) => p.value);
  const maxV = Math.max(1, ...values);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const xs =
    points.length === 1
      ? [padL + innerW / 2]
      : range(padL, padL + innerW, points.length);
  const coords = points.map((p, i) => ({
    x: xs[i],
    y: padT + innerH - (p.value / maxV) * innerH,
  }));

  const line = smoothPath(coords);
  const last = coords[coords.length - 1];
  const first = coords[0];
  const area = `${line} L ${last.x} ${padT + innerH} L ${first.x} ${
    padT + innerH
  } Z`;

  const gridYs = range(padT, padT + innerH, 4);

  // sparse x labels (about 6 max)
  const everyX = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div ref={ref} className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        height={H}
        {...a11y(ariaLabel)}
      >
        {ariaLabel ? <title>{ariaLabel}</title> : null}
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridYs.map((y, i) => (
          <line
            key={i}
            x1={padL}
            x2={W - padR}
            y1={y}
            y2={y}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
        <path d={area} fill={`url(#area-${uid})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={last.x} cy={last.y} r={3.5} fill={color} />
        <circle cx={last.x} cy={last.y} r={6} fill={color} fillOpacity={0.18} />
        {points.map((p, i) =>
          i % everyX === 0 || i === points.length - 1 ? (
            <text
              key={i}
              x={xs[i]}
              y={H - 6}
              textAnchor="middle"
              fill={FAINT}
              fontSize={11}
            >
              {p.label}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}

// ============================================================
// MultiLineChart — colorful gradient lines
// ============================================================

export interface MultiLineChartProps {
  series: { name: string; color: string; values: number[] }[];
  labels?: string[];
  height?: number;
  ariaLabel?: string;
}

export function MultiLineChart({
  series,
  labels,
  height = 200,
  ariaLabel,
}: MultiLineChartProps) {
  const uid = useId().replace(/:/g, "");
  const [ref, W] = useMeasuredWidth();
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 22;

  const len = Math.max(0, ...series.map((s) => s.values.length));
  if (series.length === 0 || len === 0) {
    return <EmptyChart height={height} />;
  }

  const maxV = Math.max(
    1,
    ...series.flatMap((s) => (s.values.length > 0 ? s.values : [0]))
  );
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xs = len === 1 ? [padL + innerW / 2] : range(padL, padL + innerW, len);
  const gridYs = range(padT, padT + innerH, 4);
  const everyX = Math.max(1, Math.ceil(len / 6));

  return (
    <div ref={ref} className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        height={H}
        {...a11y(ariaLabel)}
      >
        {ariaLabel ? <title>{ariaLabel}</title> : null}
        <defs>
          {series.map((s, si) => (
            <linearGradient
              key={si}
              id={`ml-${uid}-${si}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {gridYs.map((y, i) => (
          <line
            key={i}
            x1={padL}
            x2={W - padR}
            y1={y}
            y2={y}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
        {series.map((s, si) => {
          const coords = s.values.map((v, i) => ({
            x: xs[i] ?? padL,
            y: padT + innerH - (v / maxV) * innerH,
          }));
          if (coords.length === 0) return null;
          const line = smoothPath(coords);
          const last = coords[coords.length - 1];
          const first = coords[0];
          const area = `${line} L ${last.x} ${padT + innerH} L ${first.x} ${
            padT + innerH
          } Z`;
          return (
            <g key={si}>
              <path d={area} fill={`url(#ml-${uid}-${si})`} />
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={last.x} cy={last.y} r={3} fill={s.color} />
            </g>
          );
        })}
        {labels?.map((lab, i) =>
          i % everyX === 0 || i === len - 1 ? (
            <text
              key={i}
              x={xs[i] ?? padL}
              y={H - 6}
              textAnchor="middle"
              fill={FAINT}
              fontSize={11}
            >
              {lab}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}

// ============================================================
// BarChart — rounded 4px tops
// ============================================================

export interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  ariaLabel?: string;
}

export function BarChart({ data, height = 180, ariaLabel }: BarChartProps) {
  const [ref, W] = useMeasuredWidth();
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 24;

  if (data.length === 0) return <EmptyChart height={height} />;

  const maxV = Math.max(1, ...data.map((d) => d.value));
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const slot = innerW / data.length;
  const barW = Math.min(46, slot * 0.62);
  const r = 4;
  const gridYs = range(padT, padT + innerH, 4);

  return (
    <div ref={ref} className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        height={H}
        {...a11y(ariaLabel)}
      >
        {ariaLabel ? <title>{ariaLabel}</title> : null}
        {gridYs.map((y, i) => (
          <line
            key={i}
            x1={padL}
            x2={W - padR}
            y1={y}
            y2={y}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const h = Math.max(2, (d.value / maxV) * innerH);
          const y = padT + innerH - h;
          const x = cx - barW / 2;
          const fill = d.color ?? C.violet;
          const rr = Math.min(r, h, barW / 2);
          return (
            <g key={i}>
              <path
                d={`M ${x} ${y + h}
                    L ${x} ${y + rr}
                    Q ${x} ${y} ${x + rr} ${y}
                    L ${x + barW - rr} ${y}
                    Q ${x + barW} ${y} ${x + barW} ${y + rr}
                    L ${x + barW} ${y + h} Z`}
                fill={fill}
                fillOpacity={0.9}
              />
              <text
                x={cx}
                y={H - 7}
                textAnchor="middle"
                fill={FAINT}
                fontSize={11}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ============================================================
// DonutChart — thin ring, total centered
// ============================================================

export interface DonutChartProps {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  ariaLabel?: string;
}

export function DonutChart({ segments, size = 168, ariaLabel }: DonutChartProps) {
  const stroke = 10;
  const r = (size - stroke) / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);

  // DonutChart is square: keep its native viewBox + explicit width/height so it
  // scales proportionally. preserveAspectRatio stays at its default (xMidYMid).
  if (total <= 0) {
    return (
      <svg
        className="chart"
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{ width: size, maxWidth: "100%" }}
        {...a11y(ariaLabel)}
      >
        {ariaLabel ? <title>{ariaLabel}</title> : null}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={GRID}
          strokeWidth={stroke}
        />
        <text x={cx} y={cy + 5} textAnchor="middle" fill={FAINT} fontSize={14}>
          0
        </text>
      </svg>
    );
  }

  let offset = 0;
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      style={{ width: size, maxWidth: "100%" }}
      {...a11y(ariaLabel)}
    >
      {ariaLabel ? <title>{ariaLabel}</title> : null}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={GRID}
        strokeWidth={stroke}
      />
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {segments.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * circ;
          const seg = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${Math.max(0, dash - 1.5)} ${circ}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return seg;
        })}
      </g>
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fill={TEXT}
        fontSize={24}
        fontWeight={600}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {total.toLocaleString("en-US")}
      </text>
      <text
        x={cx}
        y={cy + 16}
        textAnchor="middle"
        fill={FAINT}
        fontSize={11}
        style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
      >
        TOTAL
      </text>
    </svg>
  );
}

// ============================================================
// Sparkline — tiny inline area
// ============================================================

export interface SparklineProps {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  ariaLabel?: string;
}

export function Sparkline({
  values,
  color = C.violet,
  width = 100,
  height = 28,
  ariaLabel,
}: SparklineProps) {
  const uid = useId().replace(/:/g, "");
  const [ref, W] = useMeasuredWidth(width);
  if (values.length === 0) {
    return (
      <div ref={ref} className="chart-wrap" style={{ width: "100%" }}>
        <svg
          viewBox={`0 0 ${W} ${height}`}
          height={height}
          style={{ width: "100%", height, display: "block" }}
          {...a11y(ariaLabel)}
        >
          {ariaLabel ? <title>{ariaLabel}</title> : null}
        </svg>
      </div>
    );
  }
  const pad = 2;
  const maxV = Math.max(1, ...values);
  const minV = Math.min(...values);
  const span = Math.max(1, maxV - minV);
  const innerW = W - pad * 2;
  const innerH = height - pad * 2;
  const xs =
    values.length === 1
      ? [pad + innerW / 2]
      : range(pad, pad + innerW, values.length);
  const coords = values.map((v, i) => ({
    x: xs[i],
    y: pad + innerH - ((v - minV) / span) * innerH,
  }));
  const line = smoothPath(coords);
  const last = coords[coords.length - 1];
  const first = coords[0];
  const area = `${line} L ${last.x} ${height - pad} L ${first.x} ${
    height - pad
  } Z`;

  return (
    <div ref={ref} className="chart-wrap" style={{ width: "100%" }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        height={height}
        style={{ width: "100%", height, display: "block" }}
        {...a11y(ariaLabel)}
      >
        {ariaLabel ? <title>{ariaLabel}</title> : null}
        <defs>
          <linearGradient id={`spark-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#spark-${uid})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={last.x} cy={last.y} r={1.6} fill={color} />
      </svg>
    </div>
  );
}

// ---- internal empty state ----------------------------------

function EmptyChart({ height }: { height: number }) {
  return (
    <div
      className="empty"
      style={{ height, padding: 0, justifyContent: "center" }}
    >
      <span className="empty__hint">No data yet</span>
    </div>
  );
}
