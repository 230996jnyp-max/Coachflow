"use client";

import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Segmented, SectionTitle, Stat } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { useNow } from "@/lib/store";
import { hasFeedback, PAIN_ALERT } from "@/lib/feedback";
import { doneWorkouts } from "@/lib/stats";
import { round } from "@/lib/utils";
import { axisProps, C, ChartBox, ChartEmpty, RANGES, rangeStart, tooltipStyle, type Range } from "./chartKit";

/** Pain and energy after each workout, over time — plus where it has been hurting. */
export function FeelTab({ clientId }: { clientId: string }) {
  const { db } = useViewer();
  const now = useNow(60_000);
  const [range, setRange] = useState<Range>("3M");
  const since = rangeStart(range, now);

  const rows = useMemo(
    () =>
      doneWorkouts(db.workouts, clientId)
        .filter((w) => hasFeedback(w.feedback) && parseISO(w.startedAt).getTime() >= since)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [db.workouts, clientId, since],
  );

  const data = rows.map((w) => ({ label: format(parseISO(w.startedAt), "d MMM"), title: w.title, pain: w.feedback?.pain ?? null, energy: w.feedback?.energy ?? null }));
  const pains = rows.map((w) => w.feedback?.pain).filter((n): n is number => n !== undefined);
  const energies = rows.map((w) => w.feedback?.energy).filter((n): n is number => n !== undefined);
  const avg = (l: number[]) => (l.length ? round(l.reduce((a, b) => a + b, 0) / l.length, 1) : null);
  const high = pains.filter((p) => p >= PAIN_ALERT).length;
  const areaCounts = new Map<string, number>();
  for (const w of rows) for (const a of w.feedback?.areas ?? []) areaCounts.set(a, (areaCounts.get(a) ?? 0) + 1);
  const areas = [...areaCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Segmented value={range} onChange={setRange} options={RANGES} />
      </div>
      {rows.length === 0 ? (
        <ChartEmpty message="No pain or energy ratings in this range yet. They're asked for when a workout is finished." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Avg pain" value={avg(pains) ?? "—"} tone={(avg(pains) ?? 0) >= PAIN_ALERT ? "danger" : "success"} sub="0 = none, 10 = worst" />
            <Stat label="Avg energy" value={avg(energies) ?? "—"} tone="accent" sub="0 = drained, 10 = full" />
            <Stat label="High-pain sessions" value={high} tone={high ? "danger" : "success"} sub={`pain ${PAIN_ALERT}+ out of 10`} />
            <Stat label="Rated sessions" value={rows.length} />
          </div>

          <section>
            <SectionTitle>Pain &amp; energy</SectionTitle>
            <Card className="p-4">
              {data.length < 2 ? (
                <ChartEmpty message="Rate at least two workouts to see a trend." />
              ) : (
                <ChartBox>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ left: -20, right: 8 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                      <YAxis {...axisProps} domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} />
                      <ReferenceLine y={PAIN_ALERT} stroke={C.danger} strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Tooltip {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line dataKey="pain" name="Pain" stroke={C.danger} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                      <Line dataKey="energy" name="Energy" stroke={C.accent} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartBox>
              )}
            </Card>
          </section>

          {areas.length > 0 && (
            <section>
              <SectionTitle>Where it hurt</SectionTitle>
              <Card className="flex flex-wrap gap-2 p-4">
                {areas.map(([a, n]) => (
                  <span key={a} className="inline-flex items-center gap-2 rounded-full border border-danger/30 bg-danger/10 px-3 py-1.5 text-sm font-semibold text-danger">
                    {a} <span className="text-xs font-bold opacity-80">×{n}</span>
                  </span>
                ))}
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
