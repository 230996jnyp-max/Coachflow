"use client";

import { subDays } from "date-fns";

/** Chart colours follow the active theme (CSS variables work in SVG attributes and inline styles). */
export const C = {
  accent: "var(--c-accent)",
  success: "var(--c-success)",
  pr: "var(--c-pr)",
  danger: "var(--c-danger)",
  purple: "var(--c-purple)",
  grid: "var(--chart-grid)",
  axis: "var(--c-muted)",
};

export const axisProps = {
  stroke: C.axis,
  tick: { fill: C.axis, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: C.grid },
} as const;

export const tooltipStyle = {
  contentStyle: {
    background: "var(--c-surface)",
    border: "1px solid var(--c-line)",
    borderRadius: 12,
    fontSize: 12,
    color: "var(--c-ink)",
  },
  labelStyle: { color: "var(--c-muted)", marginBottom: 4 },
  itemStyle: { color: "var(--c-ink)" },
  cursor: { stroke: "var(--c-line)" },
} as const;

export type Range = "1M" | "3M" | "6M" | "1Y" | "All";
export const RANGES: { value: Range; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
  { value: "All", label: "All" },
];
const DAYS: Record<Range, number> = { "1M": 30, "3M": 91, "6M": 182, "1Y": 365, All: 100000 };

export function rangeStart(range: Range, now: Date): number {
  return subDays(now, DAYS[range]).getTime();
}

export function ChartBox({ height = 260, children }: { height?: number; children: React.ReactNode }) {
  return <div style={{ height }} className="w-full">{children}</div>;
}

export function ChartEmpty({ message = "Not enough data in this range yet." }: { message?: string }) {
  return <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">{message}</div>;
}
