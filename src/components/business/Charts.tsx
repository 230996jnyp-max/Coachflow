"use client";

import { cn } from "@/lib/utils";

/** S$1,250 or S$12.50 (whole dollars when there are no cents). */
export const money = (cents: number): string => `S$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

/** "+12%" / "-5%" / "no change" next to a figure; nothing when there is nothing to compare. */
export function Delta({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return null;
  const up = value > 0;
  return <span className={cn("text-xs font-semibold", value === 0 ? "text-muted" : up ? "text-success" : "text-danger", className)}>{value === 0 ? "no change" : `${up ? "+" : ""}${value}% vs last month`}</span>;
}

/**
 * A small bar chart: one bar per value, tallest = full height. `format` shapes the number in the tooltip and the screen-reader summary;
 * `highlight` marks one bar (this month, the busiest day).
 */
export function Bars({ values, labels, format = (n) => String(n), highlight, height = 120, tone = "accent", label }: { values: number[]; labels: string[]; format?: (n: number) => string; highlight?: number; height?: number; tone?: "accent" | "success" | "pr"; label: string }) {
  const max = Math.max(1, ...values);
  const color = tone === "success" ? "bg-success" : tone === "pr" ? "bg-pr" : "bg-accent";
  const summary = `${label}: ${labels.map((l, i) => `${l} ${format(values[i] ?? 0)}`).join(", ")}`;
  return (
    <figure className="w-full" aria-label={summary}>
      <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label={summary}>
        {values.map((v, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${labels[i]}: ${format(v)}`}>
            <div className={cn("w-full rounded-t-md transition-all", color, highlight === i ? "opacity-100" : "opacity-60")} style={{ height: `${Math.max(v > 0 ? 4 : 1, (v / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 text-[10px] text-muted">
        {labels.map((l, i) => (
          <div key={i} className={cn("min-w-0 flex-1 truncate text-center", highlight === i && "font-bold text-ink")}>
            {l}
          </div>
        ))}
      </div>
    </figure>
  );
}

/** Bars stacked from several series (for example coaches, solo and clients signing up each week). */
export function StackedBars({ series, labels, colors, height = 120, label }: { series: { name: string; values: number[] }[]; labels: string[]; colors: string[]; height?: number; label: string }) {
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const summary = `${label}: ${labels.map((l, i) => `${l} ${totals[i]}`).join(", ")}`;
  return (
    <figure className="w-full" aria-label={summary}>
      <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label={summary}>
        {labels.map((l, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${l}: ${series.map((s) => `${s.name} ${s.values[i] ?? 0}`).join(", ")}`}>
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-md" style={{ height: `${Math.max(totals[i] > 0 ? 4 : 1, (totals[i] / max) * 100)}%` }}>
              {series.map((s, k) => (s.values[i] ? <div key={k} className={colors[k]} style={{ height: `${((s.values[i] ?? 0) / Math.max(1, totals[i])) * 100}%` }} /> : null))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 text-[10px] text-muted">
        {labels.map((l, i) => (
          <div key={i} className="min-w-0 flex-1 truncate text-center">
            {i % 2 === 0 ? l : ""}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
        {series.map((s, k) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-sm", colors[k])} /> {s.name}
          </span>
        ))}
      </div>
    </figure>
  );
}
