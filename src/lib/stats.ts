import {
  addWeeks,
  differenceInCalendarDays,
  format,
  isAfter,
  parseISO,
  startOfWeek,
  subDays,
} from "date-fns";
import type {
  Exercise,
  MuscleGroup,
  PRKind,
  UnitSystem,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "./types";
import { epley, fmtClock, fromKg, round, weightUnit } from "./utils";
import { formatCustomSet } from "./tracking";
import { checkSetMetrics, metricsFor, type PrMetric } from "./prMetrics";

export type ExerciseMap = Map<string, Exercise>;

export const isWeightType = (e?: Exercise) =>
  !!e && (e.type === "WEIGHT_REPS" || e.type === "WEIGHTED_BODYWEIGHT");

export const byDate = (a: Workout, b: Workout) => a.startedAt.localeCompare(b.startedAt);

/* ---------------- Per-set maths ---------------- */
export function setVolume(set: WorkoutSet, ex?: Exercise): number {
  if (!set.done || set.type === "W" || !isWeightType(ex)) return 0;
  const w = Math.max(0, set.weight ?? 0);
  return w * (set.reps ?? 0);
}

export function setE1RM(set: WorkoutSet): number {
  if (!set.weight || !set.reps || set.weight <= 0) return 0;
  return epley(set.weight, set.reps);
}

export function workoutVolume(w: Workout, exMap: ExerciseMap): number {
  let v = 0;
  for (const we of w.exercises) {
    const ex = exMap.get(we.exerciseId);
    for (const s of we.sets) v += setVolume(s, ex);
  }
  return v;
}

export function workoutSetCount(w: Workout): number {
  return w.exercises.reduce((n, we) => n + we.sets.filter((s) => s.done && s.type !== "W").length, 0);
}

export function doneWorkouts(workouts: Workout[], clientId?: string): Workout[] {
  return workouts
    .filter((w) => w.status === "DONE" && (!clientId || w.clientId === clientId))
    .sort(byDate);
}

/* ---------------- Personal records ---------------- */
interface Bests {
  weight: number;
  e1rm: number;
  volume: number;
  reps: number;
  time: number;
  distance: number;
}

/**
 * Walks a client's workouts chronologically and returns which completed sets set a record.
 * The first time an exercise is ever performed only sets the baseline (no PR badges).
 */
export function annotatePRs(workouts: Workout[], exMap: ExerciseMap): Map<string, PRKind[]> {
  const out = new Map<string, PRKind[]>();
  const bests = new Map<string, Bests>();
  // Sport drills with their own columns keep their records by metric (hold, pace for a distance, accuracy ...).
  const metricBests = new Map<string, Map<string, number>>();
  const metricDefs = new Map<string, PrMetric[]>();
  const sorted = [...workouts].sort(byDate);

  for (const w of sorted) {
    // Baselines only apply to history from *earlier* workouts, so compute flags
    // against a snapshot taken at the start of each workout's exercise entry.
    for (const we of w.exercises) {
      const ex = exMap.get(we.exerciseId);
      if (!ex) continue;
      const hadHistory = bests.has(we.exerciseId);
      const b: Bests = bests.get(we.exerciseId) ?? {
        weight: 0,
        e1rm: 0,
        volume: 0,
        reps: 0,
        time: 0,
        distance: 0,
      };
      for (const s of we.sets) {
        if (!s.done || s.type === "W") continue;
        const flags: PRKind[] = [];
        if (ex.tracking) {
          let defs = metricDefs.get(we.exerciseId);
          if (!defs) metricDefs.set(we.exerciseId, (defs = metricsFor(ex.tracking)));
          let mb = metricBests.get(we.exerciseId);
          if (!mb) metricBests.set(we.exerciseId, (mb = new Map()));
          flags.push(...checkSetMetrics(s, defs, mb));
        } else if (isWeightType(ex)) {
          const wt = s.weight ?? 0;
          const reps = s.reps ?? 0;
          if (wt > 0 && reps > 0) {
            const e = epley(wt, reps);
            const vol = wt * reps;
            if (wt > b.weight) flags.push("WEIGHT");
            if (e > b.e1rm + 0.01) flags.push("E1RM");
            if (vol > b.volume) flags.push("VOLUME");
            b.weight = Math.max(b.weight, wt);
            b.e1rm = Math.max(b.e1rm, e);
            b.volume = Math.max(b.volume, vol);
          }
        } else if (ex.type === "BODYWEIGHT_REPS") {
          const reps = s.reps ?? 0;
          if (reps > b.reps) flags.push("REPS");
          b.reps = Math.max(b.reps, reps);
        } else if (ex.type === "DURATION_ONLY") {
          const t = s.durationSec ?? 0;
          if (t > b.time) flags.push("TIME");
          b.time = Math.max(b.time, t);
        } else if (ex.type === "DURATION_DISTANCE") {
          const d = s.distanceKm ?? 0;
          if (d > b.distance) flags.push("DISTANCE");
          b.distance = Math.max(b.distance, d);
        }
        if (hadHistory && flags.length) out.set(s.id, flags);
      }
      bests.set(we.exerciseId, b);
    }
  }
  return out;
}

export const PR_LABELS: Record<PRKind, string> = {
  WEIGHT: "Heaviest weight",
  E1RM: "Est. 1RM",
  VOLUME: "Best set volume",
  REPS: "Most reps",
  TIME: "Longest hold",
  DISTANCE: "Longest distance",
  HOLD: "Longest hold",
  ROUNDS: "Most rounds",
  ROUND_TIME: "Longest round",
  PACE: "Fastest pace",
  ACCURACY: "Best accuracy",
  MAKES: "Most makes",
  METRIC: "Personal best",
};

/* ---------------- "Previous" lookup ---------------- */
export function findPrevious(
  workouts: Workout[],
  current: Workout,
  exerciseId: string,
): WorkoutExercise | undefined {
  let best: Workout | undefined;
  for (const w of workouts) {
    if (w.id === current.id || w.clientId !== current.clientId || w.status !== "DONE") continue;
    if (w.startedAt >= current.startedAt) continue;
    if (!w.exercises.some((e) => e.exerciseId === exerciseId && e.sets.some((s) => s.done))) continue;
    if (!best || w.startedAt > best.startedAt) best = w;
  }
  return best?.exercises.find((e) => e.exerciseId === exerciseId);
}

export function formatSet(set: WorkoutSet | undefined, ex: Exercise | undefined, u: UnitSystem): string {
  if (!set || !ex) return "—";
  if (ex.tracking) return formatCustomSet(set, ex.tracking);
  switch (ex.type) {
    case "WEIGHT_REPS":
    case "WEIGHTED_BODYWEIGHT": {
      if (set.reps === undefined && set.weight === undefined) return "—";
      const w = set.weight === undefined ? "BW" : `${round(fromKg(set.weight, u), 1)}${weightUnit(u)}`;
      return `${w} × ${set.reps ?? 0}`;
    }
    case "BODYWEIGHT_REPS":
      return set.reps === undefined ? "—" : `${set.reps} reps`;
    case "DURATION_ONLY":
      return set.durationSec === undefined ? "—" : fmtClock(set.durationSec);
    case "DURATION_DISTANCE": {
      const parts: string[] = [];
      if (set.distanceKm) parts.push(`${set.distanceKm}km`);
      if (set.durationSec) parts.push(fmtClock(set.durationSec));
      return parts.length ? parts.join(" · ") : "—";
    }
  }
}

/* ---------------- Aggregates ---------------- */
export interface WeekBucket {
  start: Date;
  label: string;
  volume: number;
  workouts: number;
  sets: number;
}

export function weeklyBuckets(
  workouts: Workout[],
  exMap: ExerciseMap,
  weeks: number,
  now: Date,
): WeekBucket[] {
  const thisWeek = startOfWeek(now, { weekStartsOn: 1 });
  const buckets: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addWeeks(thisWeek, -i);
    buckets.push({ start, label: format(start, "d MMM"), volume: 0, workouts: 0, sets: 0 });
  }
  for (const w of workouts) {
    if (w.status !== "DONE") continue;
    const ws = startOfWeek(parseISO(w.startedAt), { weekStartsOn: 1 });
    const idx = buckets.findIndex((b) => b.start.getTime() === ws.getTime());
    if (idx === -1) continue;
    buckets[idx].volume += workoutVolume(w, exMap);
    buckets[idx].workouts += 1;
    buckets[idx].sets += workoutSetCount(w);
  }
  return buckets;
}

/** Consecutive weeks (ending this week or last week) with at least one workout. */
export function weekStreak(workouts: Workout[], now: Date): number {
  const weeks = new Set(
    workouts
      .filter((w) => w.status === "DONE")
      .map((w) => startOfWeek(parseISO(w.startedAt), { weekStartsOn: 1 }).getTime()),
  );
  let cursor = startOfWeek(now, { weekStartsOn: 1 });
  if (!weeks.has(cursor.getTime())) cursor = addWeeks(cursor, -1);
  let n = 0;
  while (weeks.has(cursor.getTime())) {
    n++;
    cursor = addWeeks(cursor, -1);
  }
  return n;
}

export function muscleDistribution(
  workouts: Workout[],
  exMap: ExerciseMap,
  days: number,
  now: Date,
): { muscle: MuscleGroup; sets: number }[] {
  const since = subDays(now, days);
  const counts = new Map<MuscleGroup, number>();
  for (const w of workouts) {
    if (w.status !== "DONE" || !isAfter(parseISO(w.startedAt), since)) continue;
    for (const we of w.exercises) {
      const ex = exMap.get(we.exerciseId);
      if (!ex || ex.primary === "Cardio") continue;
      const n = we.sets.filter((s) => s.done && s.type !== "W").length;
      if (!n) continue;
      counts.set(ex.primary, (counts.get(ex.primary) ?? 0) + n);
    }
  }
  return [...counts.entries()]
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((a, b) => b.sets - a.sets);
}

export interface ExercisePoint {
  date: string;
  ts: number;
  label: string;
  e1rm: number;
  maxWeight: number;
  bestSetVolume: number;
  totalVolume: number;
  maxReps: number;
  totalReps: number;
  distance: number;
  duration: number;
  calories: number;
  pace: number; // min per km
}

export function exerciseHistory(workouts: Workout[], exerciseId: string, exMap: ExerciseMap): ExercisePoint[] {
  const ex = exMap.get(exerciseId);
  const pts: ExercisePoint[] = [];
  for (const w of workouts.filter((x) => x.status === "DONE").sort(byDate)) {
    const entries = w.exercises.filter((e) => e.exerciseId === exerciseId);
    if (!entries.length) continue;
    const p: ExercisePoint = {
      date: w.startedAt,
      ts: parseISO(w.startedAt).getTime(),
      label: format(parseISO(w.startedAt), "d MMM"),
      e1rm: 0,
      maxWeight: 0,
      bestSetVolume: 0,
      totalVolume: 0,
      maxReps: 0,
      totalReps: 0,
      distance: 0,
      duration: 0,
      calories: 0,
      pace: 0,
    };
    for (const we of entries) {
      for (const s of we.sets) {
        if (!s.done || s.type === "W") continue;
        p.e1rm = Math.max(p.e1rm, setE1RM(s));
        p.maxWeight = Math.max(p.maxWeight, s.weight ?? 0);
        const v = setVolume(s, ex);
        p.bestSetVolume = Math.max(p.bestSetVolume, v);
        p.totalVolume += v;
        p.maxReps = Math.max(p.maxReps, s.reps ?? 0);
        p.totalReps += s.reps ?? 0;
        p.distance += s.distanceKm ?? 0;
        p.duration += s.durationSec ?? 0;
        p.calories += s.calories ?? 0;
      }
    }
    if (p.distance > 0 && p.duration > 0) p.pace = p.duration / 60 / p.distance;
    pts.push(p);
  }
  return pts;
}

export function performedExerciseIds(workouts: Workout[]): string[] {
  const counts = new Map<string, number>();
  for (const w of workouts) {
    if (w.status !== "DONE") continue;
    for (const we of w.exercises) {
      if (we.sets.some((s) => s.done)) counts.set(we.exerciseId, (counts.get(we.exerciseId) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export interface CardioSummary {
  sessions: number;
  minutes: number;
  km: number;
  calories: number;
}

/** Rough kcal/min when a logged cardio set has no calorie value. */
const KCAL_PER_MIN: Record<string, number> = {
  "Treadmill Run": 11,
  "Outdoor Run": 11,
  "Treadmill Incline Walk": 7,
  StairMaster: 9,
  "Rowing Machine (Concept2)": 10,
  SkiErg: 10,
  "Assault Bike": 12,
  "Stationary Bike": 8,
  "Elliptical Trainer": 8,
};

export function setCalories(set: WorkoutSet, ex?: Exercise): number {
  if (set.calories) return set.calories;
  if (!set.durationSec || !ex) return 0;
  return Math.round((set.durationSec / 60) * (KCAL_PER_MIN[ex.name] ?? 8));
}

export function cardioSummary(
  workouts: Workout[],
  exMap: ExerciseMap,
  sinceDays?: number,
  now?: Date,
): CardioSummary {
  const sum: CardioSummary = { sessions: 0, minutes: 0, km: 0, calories: 0 };
  const since = sinceDays && now ? subDays(now, sinceDays) : undefined;
  for (const w of workouts) {
    if (w.status !== "DONE") continue;
    if (since && !isAfter(parseISO(w.startedAt), since)) continue;
    let had = false;
    for (const we of w.exercises) {
      const ex = exMap.get(we.exerciseId);
      if (!ex || ex.type !== "DURATION_DISTANCE") continue;
      for (const s of we.sets) {
        if (!s.done) continue;
        had = true;
        sum.minutes += (s.durationSec ?? 0) / 60;
        sum.km += s.distanceKm ?? 0;
        sum.calories += setCalories(s, ex);
      }
    }
    if (had) sum.sessions++;
  }
  return sum;
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(differenceInCalendarDays(parseISO(a), parseISO(b)));
}
