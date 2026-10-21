"use client";

import { format, parseISO, startOfWeek } from "date-fns";
import { Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, Input, Segmented, SectionTitle, Select, Stat } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { useNow } from "@/lib/store";
import {
  doneWorkouts,
  exerciseHistory,
  formatSet,
  isWeightType,
  muscleDistribution,
  performedExerciseIds,
  PR_LABELS,
  weekStreak,
  weeklyBuckets,
} from "@/lib/stats";
import { fmtVolume, fromKg, round, weightUnit } from "@/lib/utils";
import { axisProps, C, ChartBox, ChartEmpty, RANGES, rangeStart, tooltipStyle, type Range } from "./chartKit";
import { searchExercises } from "@/components/ExerciseLibrary";

type Metric = "e1rm" | "weight" | "volume" | "reps" | "time";

export function StrengthTab({ clientId }: { clientId: string }) {
  const { db, unit, exMap } = useViewer();
  const now = useNow(60_000);
  const wu = weightUnit(unit);
  const workouts = useMemo(() => doneWorkouts(db.workouts, clientId), [db.workouts, clientId]);

  const [days, setDays] = useState<"7" | "30">("30");
  const [range, setRange] = useState<Range>("3M");
  const [metric, setMetric] = useState<Metric>("e1rm");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string>("");

  const weekly = useMemo(() => weeklyBuckets(workouts, exMap, 12, now), [workouts, exMap, now]);
  const thisWeek = weekly[weekly.length - 1];
  const streak = weekStreak(workouts, now);
  const dist = useMemo(() => muscleDistribution(workouts, exMap, Number(days), now), [workouts, exMap, days, now]);

  const strengthIds = useMemo(
    () => performedExerciseIds(workouts).filter((id) => exMap.get(id)?.type !== "DURATION_DISTANCE"),
    [workouts, exMap],
  );
  const options = useMemo(
    () => searchExercises(strengthIds.map((id) => exMap.get(id)!).filter(Boolean), query),
    [strengthIds, exMap, query],
  );
  const exId = picked && strengthIds.includes(picked) ? picked : options[0]?.id ?? strengthIds[0] ?? "";
  const ex = exMap.get(exId);
  const weightBased = isWeightType(ex);
  const effMetric: Metric = weightBased
    ? metric === "reps" || metric === "time" ? "e1rm" : metric
    : ex?.type === "DURATION_ONLY" ? "time" : "reps";

  const history = useMemo(() => exerciseHistory(workouts, exId, exMap), [workouts, exId, exMap]);
  const since = rangeStart(range, now);
  const data = useMemo(
    () =>
      history
        .filter((p) => p.ts >= since)
        .map((p) => ({
          label: p.label,
          e1rm: round(fromKg(p.e1rm, unit), 1),
          weight: round(fromKg(p.maxWeight, unit), 1),
          bestSet: round(fromKg(p.bestSetVolume, unit), 0),
          volume: round(fromKg(p.totalVolume, unit), 0),
          maxReps: p.maxReps,
          totalReps: p.totalReps,
          minutes: round(p.duration / 60, 1),
        })),
    [history, since, unit],
  );

  const recentPRs = useMemo(() => {
    const out: { id: string; date: string; ex: string; text: string; kinds: string }[] = [];
    for (const w of [...workouts].reverse()) {
      for (const we of w.exercises) {
        for (const s of we.sets) {
          if (s.pr?.length) {
            out.push({
              id: s.id,
              date: w.startedAt,
              ex: exMap.get(we.exerciseId)?.name ?? "Exercise",
              text: formatSet(s, exMap.get(we.exerciseId), unit),
              kinds: s.pr.map((p) => PR_LABELS[p]).join(" · "),
            });
          }
        }
      }
      if (out.length >= 40) break;
    }
    // Keep the heaviest/most interesting: one badge per exercise per day.
    const seen = new Set<string>();
    return out.filter((o) => {
      const k = o.ex + format(parseISO(o.date), "yyyy-MM-dd");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 8);
  }, [workouts, exMap, unit]);

  if (workouts.length === 0) {
    return <ChartEmpty message="No workouts logged yet — progress will appear after the first session." />;
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Volume this week" value={fmtVolume(thisWeek.volume, unit)} tone="accent" sub={`Week of ${format(startOfWeek(now, { weekStartsOn: 1 }), "d MMM")}`} />
        <Stat label="Workouts this week" value={thisWeek.workouts} sub={`${thisWeek.sets} working sets`} />
        <Stat label="Week streak" value={`${streak} 🔥`} sub="Consecutive weeks trained" tone="pr" />
        <Stat label="Total workouts" value={workouts.length} sub="All time" />
      </div>

      <section>
        <SectionTitle>Weekly volume & frequency</SectionTitle>
        <Card className="p-3 pt-5">
          <ChartBox>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weekly.map((b) => ({ label: b.label, volume: round(fromKg(b.volume, unit), 0), workouts: b.workouts }))} margin={{ left: -10, right: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                <YAxis yAxisId="v" {...axisProps} tickFormatter={(v) => (v >= 1000 ? `${round(v / 1000, 1)}k` : String(v))} />
                <YAxis yAxisId="w" orientation="right" {...axisProps} allowDecimals={false} domain={[0, 7]} />
                <Tooltip {...tooltipStyle} formatter={(v, n) => (n === "Volume" ? [`${Number(v).toLocaleString()} ${wu}`, n] : [v, n])} />
                <Legend wrapperStyle={{ fontSize: 12, color: C.axis }} />
                <Bar yAxisId="v" dataKey="volume" name="Volume" fill={C.accent} radius={[6, 6, 0, 0]} />
                <Line yAxisId="w" dataKey="workouts" name="Workouts" stroke={C.success} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartBox>
        </Card>
      </section>

      <section>
        <SectionTitle
          action={
            <Segmented
              value={days}
              onChange={setDays}
              options={[
                { value: "7", label: "7 days" },
                { value: "30", label: "30 days" },
              ]}
            />
          }
        >
          Muscle group split (sets)
        </SectionTitle>
        <Card className="p-3 pt-5">
          {dist.length === 0 ? (
            <ChartEmpty message="No working sets logged in this window." />
          ) : (
            <ChartBox height={Math.max(180, dist.length * 34)}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dist} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid stroke={C.grid} horizontal={false} />
                  <XAxis type="number" {...axisProps} allowDecimals={false} />
                  <YAxis type="category" dataKey="muscle" {...axisProps} width={86} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v} sets`, "Working sets"]} />
                  <Bar dataKey="sets" fill={C.purple} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartBox>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>Exercise progression</SectionTitle>
        <Card className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search exercises you’ve performed…" />
            <Select value={exId} onChange={(e) => setPicked(e.target.value)} aria-label="Exercise">
              {options.length === 0 && <option value="">No matches</option>}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {weightBased ? (
              <Segmented
                value={effMetric}
                onChange={setMetric}
                options={[
                  { value: "e1rm", label: "Est. 1RM" },
                  { value: "weight", label: "Weight & best set" },
                  { value: "volume", label: "Volume" },
                ]}
              />
            ) : (
              <Badge>{ex?.type === "DURATION_ONLY" ? "Hold time" : "Bodyweight reps"}</Badge>
            )}
            <Segmented value={range} onChange={setRange} options={RANGES} />
          </div>

          {data.length < 2 ? (
            <ChartEmpty message="Log this exercise at least twice in this range to see a trend." />
          ) : (
            <ChartBox>
              <ResponsiveContainer width="100%" height="100%">
                {effMetric === "e1rm" ? (
                  <AreaChart data={data} margin={{ left: -10, right: 8 }}>
                    <defs>
                      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={C.accent} stopOpacity={0.4} />
                        <stop offset="1" stopColor={C.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                    <YAxis {...axisProps} domain={["dataMin - 5", "dataMax + 5"]} tickFormatter={(v) => String(Math.round(v))} />
                    <Tooltip {...tooltipStyle} formatter={(v) => [`${v} ${wu}`, "Est. 1RM"]} />
                    <Area dataKey="e1rm" stroke={C.accent} strokeWidth={2.5} fill="url(#g1)" dot={{ r: 3, fill: C.accent }} />
                  </AreaChart>
                ) : effMetric === "weight" ? (
                  <ComposedChart data={data} margin={{ left: -10, right: -6 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                    <YAxis yAxisId="l" {...axisProps} domain={["dataMin - 5", "dataMax + 5"]} tickFormatter={(v) => String(Math.round(v))} />
                    <YAxis yAxisId="r" orientation="right" {...axisProps} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12, color: C.axis }} />
                    <Line yAxisId="l" dataKey="weight" name={`Max weight (${wu})`} stroke={C.accent} strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line yAxisId="r" dataKey="bestSet" name={`Best set volume (${wu})`} stroke={C.pr} strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                ) : effMetric === "volume" ? (
                  <BarChart data={data} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                    <YAxis {...axisProps} />
                    <Tooltip {...tooltipStyle} formatter={(v) => [`${Number(v).toLocaleString()} ${wu}`, "Total volume"]} />
                    <Bar dataKey="volume" fill={C.success} radius={[6, 6, 0, 0]} />
                  </BarChart>
                ) : effMetric === "time" ? (
                  <AreaChart data={data} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                    <YAxis {...axisProps} />
                    <Tooltip {...tooltipStyle} formatter={(v) => [`${v} min`, "Total time"]} />
                    <Area dataKey="minutes" stroke={C.accent} fill={C.accent} fillOpacity={0.2} strokeWidth={2.5} />
                  </AreaChart>
                ) : (
                  <ComposedChart data={data} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid stroke={C.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12, color: C.axis }} />
                    <Line dataKey="maxReps" name="Best set (reps)" stroke={C.accent} strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line dataKey="totalReps" name="Total reps" stroke={C.success} strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </ChartBox>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>Recent personal records</SectionTitle>
        {recentPRs.length === 0 ? (
          <ChartEmpty message="PRs will show up here as records are broken." />
        ) : (
          <div className="space-y-2">
            {recentPRs.map((p) => (
              <Card key={p.id} className="flex items-center gap-3 p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pr/15 text-pr">
                  <Trophy size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{p.ex}</div>
                  <div className="truncate text-xs text-muted">
                    {p.text} · {p.kinds}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-muted">{format(parseISO(p.date), "d MMM")}</div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
