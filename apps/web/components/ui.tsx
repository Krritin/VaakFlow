// ============================================================
// VaakFlow — UI primitives. Tokens-only, premium, typed.
// ============================================================

import type { CSSProperties, ReactNode } from "react";
import { Sparkline } from "./charts";
import type { Tone } from "../lib/format";

// ---- Card ---------------------------------------------------

export interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  flush?: boolean;
  padSm?: boolean;
  gold?: boolean;
  style?: CSSProperties;
}

export function Card({
  children,
  className,
  hover,
  flush,
  padSm,
  gold,
  style,
}: CardProps) {
  const cls = [
    "card",
    hover ? "card--hover" : "",
    flush ? "card--flush" : "",
    padSm ? "card--pad-sm" : "",
    gold ? "glow-gold" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  );
}

// ---- CardHeader ---------------------------------------------

export interface CardHeaderProps {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}

export function CardHeader({ title, sub, right }: CardHeaderProps) {
  return (
    <div className="card-header">
      <div>
        <div className="card-header__title">{title}</div>
        {sub !== undefined && sub !== null && (
          <div className="card-header__sub">{sub}</div>
        )}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

// ---- PageHeader ---------------------------------------------

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, right }: PageHeaderProps) {
  return (
    <div className="pageheader">
      <div>
        <h1 className="pageheader__title">{title}</h1>
        {subtitle && <p className="pageheader__sub">{subtitle}</p>}
      </div>
      {right && <div className="toolbar">{right}</div>}
    </div>
  );
}

// ---- KpiCard ------------------------------------------------

const ACCENT_HEX: Record<Tone, string> = {
  violet: "#8b5cf6",
  blue: "#38bdf8",
  green: "#34d399",
  amber: "#fbbf24",
  orange: "#fb923c",
  rose: "#fb7185",
  teal: "#2dd4bf",
  muted: "#9aa3b2",
  neutral: "#eef1f7",
};

export interface KpiCardProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  accent?: Tone;
  spark?: number[];
}

export function KpiCard({ label, value, sub, accent, spark }: KpiCardProps) {
  const hex = accent ? ACCENT_HEX[accent] : undefined;
  return (
    <div className="kpi">
      {hex && (
        <span
          className="kpi__accent"
          style={{
            background: hex,
            boxShadow: `0 0 12px ${hex}66`,
          }}
        />
      )}
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      {sub !== undefined && sub !== null && (
        <div className="kpi__sub">{sub}</div>
      )}
      {spark && spark.length > 0 && (
        <div className="kpi__spark">
          <Sparkline values={spark} color={hex ?? "#8b5cf6"} height={26} />
        </div>
      )}
    </div>
  );
}

// ---- Badge --------------------------------------------------

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
}

export function Badge({ tone = "muted", children, dot }: BadgeProps) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge__dot" />}
      {children}
    </span>
  );
}

// ---- Pill ---------------------------------------------------

export interface PillProps {
  children: ReactNode;
  className?: string;
}

export function Pill({ children, className }: PillProps) {
  return <span className={`pill ${className ?? ""}`}>{children}</span>;
}

// ---- SectionLabel -------------------------------------------

export interface SectionLabelProps {
  children: ReactNode;
  style?: CSSProperties;
}

export function SectionLabel({ children, style }: SectionLabelProps) {
  return (
    <div className="section-label" style={style}>
      {children}
    </div>
  );
}

// ---- EmptyState ---------------------------------------------

export interface EmptyStateProps {
  title: ReactNode;
  hint?: ReactNode;
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="empty">
      <svg
        className="empty__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M3 9h18" />
        <path d="M8 14h8" />
      </svg>
      <div className="empty__title">{title}</div>
      {hint && <div className="empty__hint">{hint}</div>}
    </div>
  );
}

// ---- Toolbar ------------------------------------------------

export interface ToolbarProps {
  children: ReactNode;
  style?: CSSProperties;
}

export function Toolbar({ children, style }: ToolbarProps) {
  return (
    <div className="toolbar" style={style}>
      {children}
    </div>
  );
}

// ---- Segmented ----------------------------------------------

export interface SegmentedOption<T extends string> {
  label: ReactNode;
  value: T;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the radiogroup (e.g. "Range"). */
  label?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  // These are mutually-exclusive filters, not tabs — radiogroup pattern.
  // Arrow keys move selection (roving) across the options.
  const move = (delta: number) => {
    const idx = options.findIndex((o) => o.value === value);
    const base = idx < 0 ? 0 : idx;
    const next = (base + delta + options.length) % options.length;
    const opt = options[next];
    if (opt) onChange(opt.value);
  };

  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`segmented__btn ${selected ? "active" : ""}`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              }
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Skeleton -----------------------------------------------

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}

export function Skeleton({ width, height = 16, radius, style }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{
        width: width ?? "100%",
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

// ---- StatDelta ----------------------------------------------

export interface StatDeltaProps {
  value: number;
  /**
   * When true, a rising value is the "bad" trend (e.g. fault / work-order
   * volume), so up renders rose and down renders green. The arrow still points
   * in the real direction of change; only the color tone is inverted.
   */
  goodWhenDown?: boolean;
}

export function StatDelta({ value, goodWhenDown }: StatDeltaProps) {
  // Arrow follows the actual direction of change.
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "—";
  // Color tone reflects whether the change is good or bad for this metric.
  // Default: a rising value is good (renders green via .delta--up). When
  // goodWhenDown, the mapping inverts so a POSITIVE delta is bad (rose) and a
  // NEGATIVE delta is good (green). NB: .delta--up is green, .delta--down rose.
  const rising = value > 0;
  const isGood = goodWhenDown ? !rising : rising;
  const tone =
    value === 0
      ? "flat"
      : isGood
        ? "up" // good -> green (.delta--up)
        : "down"; // bad  -> rose (.delta--down)
  const text = value === 0 ? "0%" : `${Math.abs(value)}%`;
  return (
    <span className={`delta delta--${tone}`} data-dir={dir}>
      <span aria-hidden style={{ fontSize: 9 }}>
        {arrow}
      </span>
      {text}
    </span>
  );
}
