import { cn } from "@/lib/utils";

/** A tiny trend line (no axes) for dashboards. Needs two or more points; draws nothing otherwise. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 120;
  const H = 36;
  const pad = 3;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - pad - ((v - min) / span) * (H - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("h-9 w-full text-accent", className)} role="img" aria-label={label ?? "Trend"}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r={2.6} fill="currentColor" />
    </svg>
  );
}
