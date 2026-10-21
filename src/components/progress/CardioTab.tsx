"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Segmented, SectionTitle, Select, Stat } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { useNow } from "@/lib/store";
import { cardioSummary, doneWorkouts, exerciseHistory, performedExerciseIds, setCalories } from "@/lib/stats";
import { fmtClock, round } from "@/lib/utils";
import { axisProps, C, ChartBox, ChartEmpty, RANGES, rangeStart, tooltipStyle, type Range } from "./chartKit";

type CMetric = "duration" | "distance" | "pace" | "calories";

export function CardioTab({ clientId }: { clientId: string }) {
  const { db, exMap } = useViewer();
  const now = useNow(60_000);
  const workouts = useMemo(() => doneWorkouts(db.workouts, clientId), [db.workouts, clientId]);
  const [span, setSpan] = useState<"30" | "all">("30");
  const [range, setRange] = useState<Range>("3M");
  const [metric, setMetric] = useState<CMetric>("duration");
  const [picked, setPicked] = useState("");

  const summary = useMemo(
    () => cardioSummary(workouts, exMap, span === "30" ? 30 : undefined, now),
    [workouts, exMap, span, now],
  );
  const cardioIds = useMemo(
    () => performedExerciseIds(workouts).filter((id) => exMap.get(id)?.type === "DURATION_DISTANCE"),
    [workouts, exMap],
  );
  const exId = picked && cardioIds.includes(picked) ? picked : cardioIds[0] ?? "";
  const since = rangeStart(range, now);

  const data = useMemo(() => {
    const raw = exerciseHistory(workouts, exId, exMap).filter((p) => p.ts >= since);
    const ex = exMap.get(exId);
    // Calories are estimated when none were logged (matches the summary cards).
    const calMap = new Map<string, number>();
    for (const w of workouts) {
      for (const we of w.exercises) {
        if (we.exerciseId !== exId) continue;
        calMap.set(w.startedAt, (calMap.get(w.startedAt) ?? 0) + we.sets.filter((s) => s.done).reduce((n, s) => n + setCalories(s, ex), 0));
      }
    }
    return raw.map((p) => ({
      label: p.label,
      minutes: round(p.duration / 60, 1),
      km: round(p.distance, 2),
      pace: p.pace ? round(p.pace, 2) : null,
      kcal: calMap.get(p.date) ?? 0,
    }));
  }, [workouts, exId, exMap, since]);

  const hasDistance = data.some((d) => d.km > 0);
  const effMetric: CMetric = !hasDistance && (metric === "distance" || metric === "pace") ? "duration" : metric;
  const paceFmt = (v: number) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`;

  if (cardioIds.length === 0) {
    return <ChartEmpty message="No cardio sessions logged yet. Log a run, row or StairMaster session to see conditioning trends." />;
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Segmented
          value={span}
          onChange={setSpan}
          options={[
            { value: "30", label: "Last 30 days" },
            { value: "all", label: "All time" },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cardio time" value={`${Math.round(summary.minutes)} min`} tone="accent" sub={`${summary.sessions} sessions`} />
        <Stat label="Distance" value={`${round(summary.km, 1)} km`} tone="success" />
        <Stat label="Calories" value={Math.round(summary.calories).toLocaleString()} tone="pr" sub="kcal (est. where not logged)" />
        <Stat label="Avg per session" value={`${summary.sessions ? Math.round(summary.minutes / summary.sessions) : 0} min`} />
      </div>

      <section>
        <SectionTitle>Modality progression</SectionTitle>
        <Card className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={exId} onChange={(e) => setPicked(e.target.value)} aria-label="Cardio modality">
              {cardioIds.map((id) => (
                <option key={id} value={id}>
                  {exMap.get(id)?.name}
                </option>
              ))}
            </Select>
            <Segmented
              value={effMetric}
              onChange={setMetric}
              options={[
                { value: "duration", label: "Time" },
                ...(hasDistance ? [{ value: "distance" as const, label: "Distance" }, { value: "pace" as const, label: "Pace" }] : []),
                { value: "calories", label: "Kcal" },
              ]}
            />
          </div>
          <div className="flex justify-end">
            <Segmented value={range} onChange={setRange} options={RANGES} />
          </div>
          {data.length < 2 ? (
            <ChartEmpty message="Log this modality at least twice in the range to see a trend." />
          ) : (
            <ChartBox>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ left: -10, right: 8 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                  <YAxis
                    {...axisProps}
                    reversed={effMetric === "pace"}
                    domain={effMetric === "pace" ? ["dataMin - 0.2", "dataMax + 0.2"] : undefined}
                    tickFormatter={effMetric === "pace" ? (v) => paceFmt(v) : undefined}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(v) =>
                      effMetric === "duration"
                        ? [fmtClock(Number(v) * 60), "Duration"]
                        : effMetric === "distance"
                          ? [`${v} km`, "Distance"]
                          : effMetric === "pace"
                            ? [`${paceFmt(Number(v))} /km`, "Pace (lower is faster)"]
                            : [`${v} kcal`, "Calories"]
                    }
                  />
                  <Line
                    dataKey={effMetric === "duration" ? "minutes" : effMetric === "distance" ? "km" : effMetric === "pace" ? "pace" : "kcal"}
                    stroke={effMetric === "pace" ? C.success : C.accent}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartBox>
          )}
        </Card>
      </section>
    </div>
  );
}
