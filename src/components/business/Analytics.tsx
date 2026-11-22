"use client";

import { AlertTriangle, ArrowDownRight, ArrowUpRight, Download, FileText, Lightbulb, TrendingDown } from "lucide-react";
import { useState } from "react";
import { Bars, Delta } from "@/components/business/Charts";
import { Button, Card, Stat } from "@/components/ui";
import { hourLabel, monthShort, pctChange, slotLabel, WEEKDAYS, type CoachPerf, type OccupancySummary, type Retention, type Suggestion } from "@/lib/business";
import { cn } from "@/lib/utils";

/* ---------------- Class occupancy ---------------- */
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 5); // 5am to 10pm

/** When classes are full: weekdays down, hours across, darker = fuller. */
export function Heatmap({ cells }: { cells: OccupancySummary["heatmap"] }) {
  const by = new Map(cells.map((c) => [`${c.weekday}|${c.hour}`, c]));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]" role="img" aria-label={`How full classes were, by day and hour: ${cells.filter((c) => c.fillPct !== null).map((c) => `${WEEKDAYS[c.weekday]} ${hourLabel(c.hour)} ${c.fillPct}%`).join(", ") || "no classes yet"}`}>
        <div className="grid items-center gap-[3px]" style={{ gridTemplateColumns: `2.5rem repeat(${HOURS.length}, minmax(0, 1fr))` }}>
          <div />
          {HOURS.map((h) => (
            <div key={h} className="text-center text-[9px] text-muted">
              {h % 12 === 0 ? 12 : h % 12}
            </div>
          ))}
          {MON_FIRST.map((wd) => (
            <Row key={wd} wd={wd} by={by} />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted">
          <span>Emptier</span>
          {[0.15, 0.35, 0.6, 0.85, 1].map((o) => (
            <span key={o} className="h-3 w-5 rounded bg-accent" style={{ opacity: o }} />
          ))}
          <span>Fuller</span>
          <span className="ml-3 inline-flex items-center gap-1">
            <span className="h-3 w-5 rounded border border-line" /> no class then
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ wd, by }: { wd: number; by: Map<string, OccupancySummary["heatmap"][number]> }) {
  return (
    <>
      <div className="text-xs font-medium text-muted">{WEEKDAYS[wd]}</div>
      {HOURS.map((h) => {
        const c = by.get(`${wd}|${h}`);
        const fill = c?.fillPct ?? null;
        return (
          <div key={h} className="relative h-7 overflow-hidden rounded border border-line" title={c ? `${WEEKDAYS[wd]} ${hourLabel(h)}: ${fill ?? "no"}% full, ${c.classes} ${c.classes === 1 ? "class" : "classes"}` : `${WEEKDAYS[wd]} ${hourLabel(h)}: no class`}>
            {c && fill !== null && <div className="absolute inset-0 bg-accent" style={{ opacity: 0.12 + 0.88 * Math.min(1, fill / 100) }} />}
          </div>
        );
      })}
    </>
  );
}

function FillBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
        <div className={cn("h-full rounded-full", pct >= 85 ? "bg-success" : pct >= 40 ? "bg-accent" : "bg-pr")} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="tabular-nums">{pct}%</span>
    </div>
  );
}

const KIND_ICON: Record<Suggestion["kind"], React.ReactNode> = {
  full: <Lightbulb size={16} className="text-success" />,
  underfilled: <TrendingDown size={16} className="text-pr" />,
  falling: <ArrowDownRight size={16} className="text-pr" />,
  noshows: <AlertTriangle size={16} className="text-danger" />,
};

/** Everything about how full classes are: totals, the trend, what to change, fill by class and the busy-times grid. */
export function OccupancyPanel({ occ }: { occ: OccupancySummary }) {
  const t = occ.totals;
  const empty = t.classes === 0 && occ.trend.every((m) => m.classes === 0);
  const [all, setAll] = useState(false);
  if (empty) return <Card className="p-5 text-sm text-muted">No classes held yet. When classes run, how full they are shows up here.</Card>;
  const rows = all ? occ.byClass : occ.byClass.slice(0, 8);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Classes, 90 days" value={t.classes} sub={`${t.fullClasses} were full`} />
        <Stat label="Average fill" value={t.fillPct === null ? "—" : `${t.fillPct}%`} tone="success" sub="Places taken out of places" />
        <Stat label="No-shows" value={t.noShowPct === null ? "—" : `${t.noShowPct}%`} tone={t.noShowPct !== null && t.noShowPct >= 20 ? "danger" : undefined} sub="Booked but did not come" />
        <Stat label="Waitlist and cancels" value={`${t.waitlistJoins} · ${t.cancels}`} sub={`${t.lateCancels} cancelled late`} />
      </div>

      {occ.suggestions.length > 0 && (
        <Card className="space-y-3 p-5">
          <div className="text-sm font-semibold">What to look at</div>
          <ul className="space-y-2.5">
            {occ.suggestions.map((s) => (
              <li key={s.key} className="flex gap-3 text-sm">
                <span className="mt-0.5 shrink-0">{KIND_ICON[s.kind]}</span>
                <span>
                  <span className="font-semibold">{s.title}.</span> <span className="text-muted">{s.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-3 p-5">
        <div className="text-sm font-semibold">Fill by month</div>
        <Bars values={occ.trend.map((m) => m.fillPct ?? 0)} labels={occ.trend.map((m) => monthShort(m.month))} format={(n) => `${n}%`} highlight={occ.trend.length - 1} tone="success" label="Average class fill by month" />
        <p className="text-xs text-muted">{occ.trend.map((m) => `${monthShort(m.month)} ${m.fillPct === null ? "no classes" : `${m.fillPct}% (${m.classes})`}`).join(" · ")}</p>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="text-sm font-semibold">When classes are full</div>
        <Heatmap cells={occ.heatmap} />
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Class</th>
              <th className="px-2 py-2 text-right font-medium">Held</th>
              <th className="px-2 py-2 font-medium">Fill</th>
              <th className="px-2 py-2 text-right font-medium">Came</th>
              <th className="px-2 py-2 text-right font-medium">No-show</th>
              <th className="px-4 py-2 text-right font-medium">Waitlist</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key} className="border-t border-line">
                <td className="px-4 py-2 font-medium">{slotLabel(s)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{s.sessions}</td>
                <td className="px-2 py-2">
                  <FillBar pct={s.fillPct} />
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{s.attendedPct === null ? "—" : `${s.attendedPct}%`}</td>
                <td className="px-2 py-2 text-right tabular-nums">{s.noShowPct === null ? "—" : `${s.noShowPct}%`}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.waitlistJoins}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {occ.byClass.length > 8 && (
          <div className="border-t border-line p-2 text-center">
            <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${occ.byClass.length} classes`}
            </Button>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted">Counts for the last 90 days (the trend, six months). Waitlist and cancellation numbers are counted from the day this was switched on, so they build up over the coming weeks.</p>
    </div>
  );
}

/* ---------------- Coach performance ---------------- */
const retText = (r: Retention) => (r.cohort === 0 ? "—" : r.pct === null ? `${r.kept}/${r.cohort}` : `${r.pct}% (${r.kept}/${r.cohort})`);
const pctText = (n: number | null) => (n === null ? "—" : `${n}%`);

function Trend({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return null;
  const c = pctChange(cur, prev);
  if (c === null || c === 0) return null;
  return c > 0 ? <ArrowUpRight size={12} className="ml-0.5 inline text-success" aria-label="up on the 30 days before" /> : <ArrowDownRight size={12} className="ml-0.5 inline text-danger" aria-label="down on the 30 days before" />;
}

/** A gym's table of its coaches. Counts and percentages only. */
export function PerformanceTable({ rows }: { rows: CoachPerf[] }) {
  if (!rows.length) return <Card className="p-5 text-sm text-muted">No active coaches yet.</Card>;
  const avg = (f: (p: CoachPerf) => number | null) => {
    const xs = rows.map(f).filter((x): x is number => x !== null);
    return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  };
  const low = (v: number | null, a: number | null, gap = 15) => v !== null && a !== null && v <= a - gap;
  const aAtt = avg((p) => p.attendancePct);
  const aRet = avg((p) => p.retention.m3.pct);
  const aEng = avg((p) => p.engagedPct);
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Coach</th>
            <th className="px-2 py-2 text-right font-medium">Clients</th>
            <th className="px-2 py-2 text-right font-medium">Sessions, 30d</th>
            <th className="px-2 py-2 text-right font-medium">Hours</th>
            <th className="px-2 py-2 text-right font-medium">Attendance</th>
            <th className="px-2 py-2 text-right font-medium">Cancelled</th>
            <th className="px-2 py-2 text-right font-medium">Classes (fill)</th>
            <th className="px-2 py-2 text-right font-medium">Kept, 3 mo</th>
            <th className="px-2 py-2 text-right font-medium">Kept, 6 mo</th>
            <th className="px-2 py-2 text-right font-medium">Workouts / client / wk</th>
            <th className="px-4 py-2 text-right font-medium">Active in 2 wks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-line">
              <td className="px-4 py-2 font-medium">{p.name}</td>
              <td className="px-2 py-2 text-right tabular-nums">{p.clients}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {p.sessions30}
                <Trend cur={p.sessions30} prev={p.sessionsPrev30} />
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{p.hours30}</td>
              <td className={cn("px-2 py-2 text-right tabular-nums", low(p.attendancePct, aAtt) && "font-semibold text-danger")}>{pctText(p.attendancePct)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{pctText(p.cancelPct)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{p.classes30 ? `${p.classes30} (${pctText(p.classFillPct)})` : "—"}</td>
              <td className={cn("px-2 py-2 text-right tabular-nums", low(p.retention.m3.pct, aRet) && "font-semibold text-danger")}>{retText(p.retention.m3)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{retText(p.retention.m6)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{p.workoutsPerClientWeek ?? "—"}</td>
              <td className={cn("px-4 py-2 text-right tabular-nums", low(p.engagedPct, aEng) && "font-semibold text-danger")}>{pctText(p.engagedPct)}</td>
            </tr>
          ))}
          <tr className="border-t border-line bg-field/50 text-xs text-muted">
            <td className="px-4 py-2 font-medium">Average per coach</td>
            <td className="px-2 py-2 text-right tabular-nums">{avg((p) => p.clients) ?? "—"}</td>
            <td className="px-2 py-2 text-right tabular-nums">{avg((p) => p.sessions30) ?? "—"}</td>
            <td className="px-2 py-2 text-right tabular-nums">{avg((p) => p.hours30) ?? "—"}</td>
            <td className="px-2 py-2 text-right tabular-nums">{pctText(aAtt)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{pctText(avg((p) => p.cancelPct))}</td>
            <td className="px-2 py-2 text-right tabular-nums">{pctText(avg((p) => p.classFillPct))}</td>
            <td className="px-2 py-2 text-right tabular-nums">{pctText(aRet)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{pctText(avg((p) => p.retention.m6.pct))}</td>
            <td className="px-2 py-2 text-right tabular-nums">{avg((p) => p.workoutsPerClientWeek) ?? "—"}</td>
            <td className="px-4 py-2 text-right tabular-nums">{pctText(aEng)}</td>
          </tr>
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">
        Kept = clients who started that long ago and still trained in the last 30 days (a percentage shows with 3 or more clients). Attendance is present against no-show over 90 days. Red marks a figure well below the average. Only counts are shown, never client names or details.
      </p>
    </Card>
  );
}

/** A coach's own performance: the same measures, set against their own last 30 days. */
export function MyPerformance({ p }: { p: CoachPerf }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sessions, 30 days" value={p.sessions30} tone="accent" sub={<Delta value={pctChange(p.sessions30, p.sessionsPrev30)} className="whitespace-nowrap" />} />
        <Stat label="Attendance" value={pctText(p.attendancePct)} tone={p.attendancePct !== null && p.attendancePct < 80 ? "danger" : undefined} sub={`${p.noShows90} no-shows, 90 days`} />
        <Stat label="Cancelled" value={pctText(p.cancelPct)} sub={`${p.cancels90} sessions, 90 days`} />
        <Stat label="Clients active" value={pctText(p.engagedPct)} tone="success" sub="Logged a workout in 2 weeks" />
      </div>
      <Card className="space-y-3 p-5">
        <div className="text-sm font-semibold">Do clients stay?</div>
        <div className="grid grid-cols-3 gap-3 text-center">
          {([["After 1 month", p.retention.m1], ["After 3 months", p.retention.m3], ["After 6 months", p.retention.m6]] as const).map(([label, r]) => (
            <div key={label} className="rounded-xl border border-line bg-field/40 p-3">
              <div className="text-lg font-bold tabular-nums">{r.cohort === 0 ? "—" : r.pct === null ? `${r.kept}/${r.cohort}` : `${r.pct}%`}</div>
              <div className="text-[11px] text-muted">{label}</div>
              {r.cohort > 0 && r.pct !== null && (
                <div className="mt-0.5 text-[10px] text-muted">
                  {r.kept} of {r.cohort}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">
          Of the clients who started that long ago, how many still trained in the last 30 days. {p.workoutsPerClientWeek === null ? "" : `Your active clients log about ${p.workoutsPerClientWeek} workouts a week each. `}
          {p.classes30 ? `You held ${p.classes30} ${p.classes30 === 1 ? "class" : "classes"} in the last 30 days (${pctText(p.classFillPct)} full, ${p.classAttendees30} people came).` : ""}
        </p>
      </Card>
    </div>
  );
}

/* ---------------- Downloads ---------------- */
/** CSV downloads and the PDF report for one view of the Business page. */
export function ExportBar({ view, performance, onReport }: { view: "coach" | "gym"; performance: boolean; onReport: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {performance && (
        <a href={`/api/business/export?view=${view}&report=performance`}>
          <Button size="sm" variant="secondary" type="button">
            <Download size={14} /> {view === "gym" ? "Coaches CSV" : "My performance CSV"}
          </Button>
        </a>
      )}
      <a href={`/api/business/export?view=${view}&report=classes`}>
        <Button size="sm" variant="secondary" type="button">
          <Download size={14} /> Classes CSV
        </Button>
      </a>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onReport();
          } catch {
            setError("Couldn't make the report. Try again.");
          }
          setBusy(false);
        }}
      >
        <FileText size={14} /> {busy ? "Making the report…" : "Monthly report (PDF)"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
