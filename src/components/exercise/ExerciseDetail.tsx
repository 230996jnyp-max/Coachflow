/* eslint-disable @next/next/no-img-element */
"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, Modal, Select, Segmented } from "@/components/ui";
import { axisProps, C, ChartBox, tooltipStyle } from "@/components/progress/chartKit";
import { MEASURE_LABELS } from "@/data/exercises";
import { useViewer } from "@/lib/hooks";
import { mediaImage, useExerciseMedia, type MediaEntry } from "@/lib/exerciseMedia";
import { doneWorkouts, exerciseHistory, formatSet, type ExercisePoint } from "@/lib/stats";
import type { Exercise, MeasureType } from "@/lib/types";
import { cn, fmtClock, fromKg, round, weightUnit } from "@/lib/utils";
import { MuscleMap } from "./MuscleMap";

type Tab = "summary" | "history" | "howto";

interface Metric {
  key: keyof ExercisePoint;
  label: string;
  kind: "weight" | "reps" | "seconds" | "km";
}

function metricsFor(type: MeasureType): Metric[] {
  switch (type) {
    case "WEIGHT_REPS":
    case "WEIGHTED_BODYWEIGHT":
      return [
        { key: "maxWeight", label: "Heaviest Weight", kind: "weight" },
        { key: "e1rm", label: "One Rep Max", kind: "weight" },
        { key: "bestSetVolume", label: "Best Set Volume", kind: "weight" },
      ];
    case "BODYWEIGHT_REPS":
      return [
        { key: "maxReps", label: "Most Reps", kind: "reps" },
        { key: "totalReps", label: "Total Reps", kind: "reps" },
      ];
    case "DURATION_ONLY":
      return [{ key: "duration", label: "Longest Hold", kind: "seconds" }];
    case "DURATION_DISTANCE":
      return [
        { key: "distance", label: "Distance", kind: "km" },
        { key: "duration", label: "Time", kind: "seconds" },
      ];
  }
}

const TIPS: Record<MeasureType, string[]> = {
  WEIGHT_REPS: ["Warm up with a lighter set first.", "Control the lowering phase and use the full range of motion you can own.", "Stop 1–2 reps before form breaks down unless the plan calls for failure."],
  WEIGHTED_BODYWEIGHT: ["Master bodyweight reps before adding load.", "Move smoothly — no swinging or bouncing.", "Add weight in small steps."],
  BODYWEIGHT_REPS: ["Keep your core braced and your body in one line.", "Quality reps over quantity.", "Progress by adding reps, slowing the tempo, or choosing a harder variation."],
  DURATION_ONLY: ["Breathe steadily and keep tension through the whole body.", "End the set when form slips, not when you are completely spent."],
  DURATION_DISTANCE: ["Warm up for 3–5 minutes at an easy pace.", "Track time and distance (or level) so you can beat them next session.", "Cool down and let your heart rate settle."],
};

function PRMedal({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-label="Personal record">
      <path d="M18 40 L10 58 L22 53 L28 62 L34 42 Z" fill="#F59E0B" />
      <path d="M46 40 L54 58 L42 53 L36 62 L30 42 Z" fill="#D97706" />
      <circle cx="32" cy="26" r="22" fill="#FACC15" />
      <circle cx="32" cy="26" r="17" fill="none" stroke="#FDE68A" strokeWidth="2" />
      <text x="32" y="32" textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
        PR
      </text>
    </svg>
  );
}

export function ExerciseDetailModal({ exercise, onClose, clientId }: { exercise: Exercise | null; onClose: () => void; clientId?: string }) {
  return exercise ? <Detail key={exercise.id} exercise={exercise} onClose={onClose} clientId={clientId} /> : null;
}

function Detail({ exercise, onClose, clientId }: { exercise: Exercise; onClose: () => void; clientId?: string }) {
  const { db, user, isTrainer, clients, unit, exMap } = useViewer();
  const { entry, loading } = useExerciseMedia(exercise.id);
  const [tab, setTab] = useState<Tab>("summary");
  const [picked, setPicked] = useState<string | null>(null);
  const [metricKey, setMetricKey] = useState<keyof ExercisePoint | null>(null);

  const choices = useMemo(
    () => (isTrainer ? clients.filter((c) => !c.profile.archived).map((c) => ({ id: c.user.id, name: c.user.name })) : user ? [{ id: user.id, name: user.name }] : []),
    [isTrainer, clients, user],
  );
  const hasHistory = useMemo(() => {
    const s = new Set<string>();
    for (const w of db.workouts) if (w.status === "DONE" && w.exercises.some((e) => e.exerciseId === exercise.id && e.sets.some((x) => x.done))) s.add(w.clientId);
    return s;
  }, [db.workouts, exercise.id]);
  const selectedId = picked ?? (clientId && choices.some((c) => c.id === clientId) ? clientId : (choices.find((c) => hasHistory.has(c.id))?.id ?? choices[0]?.id ?? ""));

  const workouts = useMemo(() => doneWorkouts(db.workouts, selectedId), [db.workouts, selectedId]);
  const points = useMemo(() => exerciseHistory(workouts, exercise.id, exMap), [workouts, exercise.id, exMap]);
  const metrics = metricsFor(exercise.type);
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];

  const conv = (v: number) => (metric.kind === "weight" ? round(fromKg(v, unit), 1) : metric.kind === "seconds" ? Math.round(v) : metric.kind === "km" ? round(v, 2) : v);
  const series = points
    .map((p) => ({ label: format(parseISO(p.date), "d MMM"), v: conv(Number(p[metric.key]) || 0) }))
    .filter((p) => p.v > 0);
  const record = series.reduce<{ v: number; label: string } | null>((best, p) => (!best || p.v >= best.v ? p : best), null);
  const fmtVal = (v: number) =>
    metric.kind === "weight" ? `${v} ${weightUnit(unit)}` : metric.kind === "seconds" ? fmtClock(v) : metric.kind === "km" ? `${v} km` : `${v}`;

  const sessions = useMemo(() => {
    const out: { id: string; date: string; title: string; sets: string[]; prs: number }[] = [];
    for (const w of [...workouts].reverse()) {
      const entries = w.exercises.filter((e) => e.exerciseId === exercise.id);
      const sets = entries.flatMap((e) => e.sets.filter((s) => s.done));
      if (!sets.length) continue;
      out.push({
        id: w.id,
        date: w.startedAt,
        title: w.title,
        sets: sets.map((s) => `${s.type === "W" ? "W · " : ""}${formatSet(s, exercise, unit)}`),
        prs: sets.filter((s) => s.pr?.length).length,
      });
    }
    return out;
  }, [workouts, exercise, unit]);

  return (
    <Modal open onClose={onClose} title={exercise.name} wide>
      <div className="space-y-5">
        <Segmented
          className="w-full [&>button]:flex-1"
          value={tab}
          onChange={setTab}
          options={[
            { value: "summary", label: "Summary" },
            { value: "history", label: `History${sessions.length ? ` (${sessions.length})` : ""}` },
            { value: "howto", label: "How to" },
          ]}
        />

        {tab === "summary" && (
          <>
            <Media exercise={exercise} entry={entry} loading={loading} />
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{exercise.equipment}</Badge>
              <Badge>{MEASURE_LABELS[exercise.type]}</Badge>
              {entry?.lv && <Badge className="capitalize">{entry.lv}</Badge>}
              {exercise.custom && <Badge className="border-accent/30 bg-accent/15 text-accent">Custom</Badge>}
            </div>
            {/* Exercises without a photo already show the muscle diagram in the media area above. */}
            {(entry || loading) && (
              <Card className="p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Muscles worked</div>
                <MuscleMap primary={exercise.primary} secondary={exercise.secondary} />
              </Card>
            )}

            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">Progress</div>
                {choices.length > 1 && (
                  <Select value={selectedId} onChange={(e) => setPicked(e.target.value)} className="h-9 w-auto min-w-40 text-xs" aria-label="Client">
                    {choices.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {hasHistory.has(c.id) ? "" : " (no history)"}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
              {series.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">No history for this exercise yet. Log a workout with it to see progress and PRs here.</p>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-3xl font-bold tabular-nums">{record ? fmtVal(record.v) : "—"}</div>
                      <div className="text-sm text-muted">{record?.label}</div>
                    </div>
                    <PRMedal className="h-14 w-14 shrink-0" />
                  </div>
                  <ChartBox height={200}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={series} margin={{ left: -14, right: 10, top: 10 }}>
                        <CartesianGrid stroke={C.grid} vertical={false} />
                        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                        <YAxis {...axisProps} domain={[0, "dataMax + 5"]} tickFormatter={(v) => (metric.kind === "seconds" ? fmtClock(v) : String(Math.round(v)))} />
                        <Tooltip {...tooltipStyle} formatter={(v) => [fmtVal(Number(v)), metric.label]} />
                        <Line dataKey="v" stroke={C.accent} strokeWidth={2.5} dot={{ r: 3.5, fill: C.accent, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                        {record && <ReferenceDot x={record.label} y={record.v} r={6} fill="#FACC15" stroke="#fff" strokeWidth={2} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartBox>
                  <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
                    {metrics.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => setMetricKey(m.key)}
                        className={cn(
                          "min-h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors",
                          m.key === metric.key ? "bg-accent text-on-accent" : "bg-field text-muted hover:text-ink",
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </>
        )}

        {tab === "history" && (
          <div className="space-y-2">
            {choices.length > 1 && (
              <Select value={selectedId} onChange={(e) => setPicked(e.target.value)} aria-label="Client">
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {hasHistory.has(c.id) ? "" : " (no history)"}
                  </option>
                ))}
              </Select>
            )}
            {sessions.length === 0 && <p className="py-8 text-center text-sm text-muted">Nothing logged yet.</p>}
            {sessions.map((s) => (
              <Card key={s.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{s.title}</div>
                    <div className="text-xs text-muted">{format(parseISO(s.date), "EEE d MMM yyyy")}</div>
                  </div>
                  {s.prs > 0 && <Badge className="border-pr/30 bg-pr/15 text-pr">{s.prs} PR{s.prs > 1 ? "s" : ""}</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.sets.map((t, i) => (
                    <span key={i} className="rounded-lg bg-field px-2 py-1 text-xs tabular-nums">
                      {t}
                    </span>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === "howto" && (
          <div className="space-y-4">
            {entry?.s?.length ? (
              <ol className="space-y-3">
                {entry.s.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted">{loading ? "Loading instructions…" : "Step-by-step instructions aren’t available for this exercise yet. General tips:"}</p>
                {!loading && (
                  <ul className="list-disc space-y-1.5 pl-5 text-sm">
                    {TIPS[exercise.type].map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {entry && (
              <p className="border-t border-line pt-3 text-[11px] text-muted">
                Exercise photos and instructions from the open-source <span className="font-semibold">free-exercise-db</span> (public domain).
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Start/end photos that alternate, falling back to the generated muscle diagram. */
function Media({ exercise, entry, loading }: { exercise: Exercise; entry: MediaEntry | null; loading: boolean }) {
  const [frame, setFrame] = useState(0);
  const [broken, setBroken] = useState(false);
  const frames = entry && !broken ? entry.n : 0;

  useEffect(() => {
    if (frames < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % frames), 1100);
    return () => clearInterval(t);
  }, [frames]);

  if (loading) return <div className="aspect-[4/3] animate-pulse rounded-2xl bg-field" aria-label="Loading photo" />;
  if (!entry || broken) {
    return (
      <div className="rounded-2xl border border-line bg-field/50 p-4">
        <MuscleMap primary={exercise.primary} secondary={exercise.secondary} />
        <p className="mt-2 text-center text-[11px] text-muted">No photo for this exercise — showing the muscles it trains.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-white">
        {Array.from({ length: entry.n }, (_, i) => (
          <img
            key={i}
            src={mediaImage(entry, i)}
            alt={`${exercise.name} — position ${i + 1}`}
            onError={() => setBroken(true)}
            className={cn("absolute inset-0 h-full w-full object-contain transition-opacity duration-300", i === frame ? "opacity-100" : "opacity-0")}
          />
        ))}
      </div>
      {entry.n > 1 && (
        <div className="mt-2 flex justify-center gap-2">
          {Array.from({ length: entry.n }, (_, i) => (
            <button key={i} aria-label={`Show position ${i + 1}`} onClick={() => setFrame(i)} className="flex h-6 w-6 items-center justify-center">
              <span className={cn("h-2 w-2 rounded-full", i === frame ? "bg-accent" : "bg-line")} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
