"use client";

import { subDays } from "date-fns";

export const C = {
  accent: "#3B82F6",
  success: "#10B981",
  pr: "#F59E0B",
  danger: "#EF4444",
  purple: "#A78BFA",
  grid: "#262E40",
  axis: "#8892A6",
};

export const axisProps = {
  stroke: C.axis,
  tick: { fill: C.axis, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: C.grid },
} as const;

export const tooltipStyle = {
  contentStyle: {
    background: "#121620",
    border: "1px solid #262E40",
    borderRadius: 12,
    fontSize: 12,
    color: "#E8ECF4",
  },
  labelStyle: { color: "#8892A6", marginBottom: 4 },
  itemStyle: { color: "#E8ECF4" },
  cursor: { stroke: "#262E40" },
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
