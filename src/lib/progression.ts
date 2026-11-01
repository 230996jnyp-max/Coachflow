import { metricsFor } from "./prMetrics";
import { epley, fromKg, round, toKg } from "./utils";
import type { Exercise, TrackingSchema, UnitSystem, Workout, WorkoutSet } from "./types";

/*
 * "Suggested today": what to aim for in each set, from the last few sessions of the same exercise. Plain rules (no AI), so it is
 * instant and never runs out. Progressive overload when the last session went well, a deload when progress has stalled.
 * Pure functions, shared by the logger, the coach's brief and the tests.
 */

export type SetTarget = Pick<WorkoutSet, "weight" | "reps" | "durationSec" | "distanceKm" | "custom">;

export interface Suggestion {
  kind: "PROGRESS" | "REPEAT" | "DELOAD";
  /** One target per working set of the last session (the logger uses the one matching each set's position, or the last). */
  sets: SetTarget[];
  /** Why, in a sentence (from the rules). */
  reason: string;
  /** A short fact sheet for the optional plain-English explanation (never includes names). */
  facts: string;
}

export interface SuggestOptions {
  unit: UnitSystem;
  /** The routine's target rep range for this exercise, when there is one. */
  repMin?: number;
  repMax?: number;
}

const BARBELL = new Set(["Barbell", "Trap Bar", "Smith Machine", "EZ-Bar"]);
/** Effort at or below this counts as manageable; at or above DELOAD_RPE the session was a grind. */
export const MANAGEABLE_RPE = 8.5;
export const DELOAD_RPE = 9.5;
const DELOAD_FACTOR = 0.9;

interface Session {
  date: string;
  sets: WorkoutSet[];
  maxRpe: number | undefined;
  e1rm: number;
  volume: number;
  totalReps: number;
  topValue: number | undefined;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const working = (sets: WorkoutSet[]) => sets.filter((s) => s.done && s.type !== "W");

/** The finished sessions of one exercise, newest first (the workout being logged right now is left out). */
function sessionsOf(history: Workout[], exerciseId: string, ex: Exercise, skipId?: string): Session[] {
  const out: Session[] = [];
  const defs = ex.tracking ? metricsFor(ex.tracking) : [];
  for (const w of [...history].filter((x) => x.status === "DONE" && x.id !== skipId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    const sets = w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => working(e.sets));
    if (!sets.length) continue;
    const rpes = sets.map((s) => s.rpe).filter((x): x is number => typeof x === "number");
    let topValue: number | undefined;
    if (defs[0]) {
      const vals = sets.map((s) => defs[0].read(s.custom ?? {})?.value).filter((x): x is number => x !== undefined);
      if (vals.length) topValue = defs[0].better === "high" ? Math.max(...vals) : Math.min(...vals);
    }
    out.push({
      date: w.startedAt,
      sets,
      maxRpe: rpes.length ? Math.max(...rpes) : undefined,
      e1rm: Math.max(0, ...sets.map((s) => (s.weight && s.reps ? epley(s.weight, s.reps) : 0))),
      volume: sets.reduce((v, s) => v + (s.weight ?? 0) * (s.reps ?? 0), 0),
      totalReps: sets.reduce((v, s) => v + (s.reps ?? 0), 0),
      topValue,
    });
    if (out.length >= 4) break;
  }
  return out;
}

/** The progress number of a session (higher is always better here: for pace-like values it is flipped by the caller). */
function strength(ex: Exercise, s: Session): number {
  if (ex.tracking) return s.topValue ?? 0;
  if (ex.type === "WEIGHT_REPS" || ex.type === "WEIGHTED_BODYWEIGHT") return s.e1rm;
  if (ex.type === "BODYWEIGHT_REPS") return s.totalReps;
  if (ex.type === "DURATION_ONLY") return Math.max(0, ...s.sets.map((x) => x.durationSec ?? 0));
  return Math.max(0, ...s.sets.map((x) => x.distanceKm ?? 0));
}

const lowerIsBetter = (ex: Exercise) => !!ex.tracking && metricsFor(ex.tracking)[0]?.better === "low";

/** Has progress stalled (no improvement across 2 sessions in a row), or were targets missed / effort maxed repeatedly? */
function needsDeload(ex: Exercise, ss: Session[], opts: SuggestOptions): string | null {
  const flip = lowerIsBetter(ex) ? -1 : 1;
  const v = ss.map((s) => strength(ex, s) * flip);
  if (ss.length >= 3 && strength(ex, ss[0]) > 0 && v[0] <= v[1] && v[1] <= v[2]) return "Progress has stalled for two sessions in a row.";
  if (opts.repMin && ss.length >= 2 && ss.slice(0, 2).every((s) => s.sets.some((x) => (x.reps ?? 0) > 0 && (x.reps ?? 0) < opts.repMin!))) return "Target reps were missed in the last two sessions.";
  const hard = ss.slice(0, 3).filter((s) => (s.maxRpe ?? 0) >= DELOAD_RPE).length;
  if (hard >= 2) return "Effort has been maxed out (RPE 9.5 to 10) in recent sessions.";
  return null;
}

/* ---------------- Rules per kind of exercise ---------------- */
function weightSets(ex: Exercise, last: Session, opts: SuggestOptions, mode: "PROGRESS" | "REPEAT" | "DELOAD"): SetTarget[] {
  const u = opts.unit;
  const barbell = BARBELL.has(ex.equipment);
  const step = u === "metric" ? 2.5 : 5;
  const small = u === "metric" ? 1 : 2;
  return last.sets.map((s) => {
    const w = s.weight !== undefined ? fromKg(s.weight, u) : undefined;
    const reps = s.reps ?? 0;
    if (mode === "REPEAT") return { weight: s.weight, reps };
    if (mode === "DELOAD") return { weight: w !== undefined ? toKg(roundTo(w * DELOAD_FACTOR, step), u) : undefined, reps };
    // Progress: a barbell goes up a plate step; other kit goes up in reps first, then a small step once the reps are high.
    const topped = opts.repMax ? reps >= opts.repMax : reps >= 15;
    if (barbell || w === undefined) return { weight: w !== undefined ? toKg(round(w + step, 2), u) : undefined, reps: opts.repMin && w !== undefined ? Math.max(opts.repMin, Math.min(reps, opts.repMax ?? reps)) : reps };
    if (topped) return { weight: toKg(round(w + small, 2), u), reps: Math.max(opts.repMin ?? 6, reps - 4) };
    return { weight: s.weight, reps: reps + (reps < 8 ? 2 : 1) };
  });
}

function repsSets(last: Session, mode: "PROGRESS" | "REPEAT" | "DELOAD"): SetTarget[] {
  return last.sets.map((s) => {
    const r = s.reps ?? 0;
    return { reps: mode === "REPEAT" ? r : mode === "DELOAD" ? Math.max(1, Math.round(r * DELOAD_FACTOR)) : r + (r < 10 ? 2 : 1) };
  });
}

function timeSets(last: Session, mode: "PROGRESS" | "REPEAT" | "DELOAD"): SetTarget[] {
  return last.sets.map((s) => {
    const t = s.durationSec ?? 0;
    return { durationSec: mode === "REPEAT" ? t : mode === "DELOAD" ? Math.max(5, Math.round((t * DELOAD_FACTOR) / 5) * 5) : t + (t < 60 ? 5 : 10) };
  });
}

function distanceSets(last: Session, mode: "PROGRESS" | "REPEAT" | "DELOAD"): SetTarget[] {
  return last.sets.map((s) => {
    const d = s.distanceKm ?? 0;
    const f = mode === "REPEAT" ? 1 : mode === "DELOAD" ? DELOAD_FACTOR : 1.05;
    return { distanceKm: round(d * f, 2), durationSec: s.durationSec };
  });
}

/** Sport drills: nudge the one number that matters (hold, rounds, makes, pace ...), keep the rest as it was. */
function drillSets(schema: TrackingSchema, last: Session, mode: "PROGRESS" | "REPEAT" | "DELOAD"): SetTarget[] {
  const keys = new Set(schema.columns.map((c) => c.key));
  const col = (k: string) => schema.columns.find((c) => c.key === k);
  return last.sets.map((s) => {
    const c: Record<string, number | string> = { ...(s.custom ?? {}) };
    const num = (k: string) => (typeof c[k] === "number" ? (c[k] as number) : undefined);
    const f = mode === "DELOAD" ? DELOAD_FACTOR : 1;
    if (mode !== "REPEAT") {
      if (keys.has("made") && keys.has("attempted")) {
        const att = num("attempted");
        const made = num("made");
        if (att !== undefined && made !== undefined) c.made = mode === "DELOAD" ? Math.max(0, Math.round(made * f)) : Math.min(att, made + (att - made >= 2 && made / att < 0.6 ? 2 : 1));
      } else if (keys.has("distance") && keys.has("time") && keys.has("stroke")) {
        // Swimming: the same distance a touch faster (about 2%, at least a second); a deload is a touch slower.
        const t = num("time");
        if (t !== undefined) c.time = mode === "DELOAD" ? Math.round(t / f) : Math.max(1, Math.round(Math.min(t * 0.98, t - 1)));
      } else if (keys.has("rounds")) {
        const r = num("rounds");
        if (r !== undefined) c.rounds = mode === "DELOAD" ? Math.max(1, Math.round(r * f)) : r + 1;
      } else if (keys.has("hold")) {
        const h = num("hold");
        if (h !== undefined) c.hold = mode === "DELOAD" ? Math.max(5, Math.round((h * f) / 5) * 5) : h + (h < 30 ? 5 : 10);
      } else {
        const p = col(schema.primary);
        const v = num(schema.primary);
        if (p && v !== undefined && (p.kind === "number" || p.kind === "duration")) {
          const lower = lowerIsBetter({ tracking: schema } as Exercise);
          if (lower) c[schema.primary] = mode === "DELOAD" ? Math.round(v / f) : Math.max(1, Math.round(v * 0.97));
          else c[schema.primary] = mode === "DELOAD" ? Math.max(1, Math.round(v * f)) : p.kind === "duration" ? v + (v < 60 ? 5 : 10) : v + (v > 20 ? Math.round(v * 0.05) : 1);
        }
      }
    }
    return { custom: c };
  });
}

/**
 * The target for each set of an exercise today, or null when there is no history for it yet.
 * `history` is the client's finished workouts; `skipWorkoutId` leaves out the one being logged.
 */
export function suggestFor(ex: Exercise, history: Workout[], opts: SuggestOptions, skipWorkoutId?: string): Suggestion | null {
  const ss = sessionsOf(history, ex.id, ex, skipWorkoutId);
  if (!ss.length) return null;
  const last = ss[0];
  const deload = needsDeload(ex, ss, opts);
  const manageable = last.maxRpe === undefined || last.maxRpe <= MANAGEABLE_RPE;
  // With a rep range, every set must have reached the bottom of it; without one, finishing every set is enough.
  const reached = opts.repMin ? last.sets.every((s) => (s.reps ?? 0) >= opts.repMin! || ex.tracking || ex.type === "DURATION_ONLY" || ex.type === "DURATION_DISTANCE") : true;
  const mode: "PROGRESS" | "REPEAT" | "DELOAD" = deload ? "DELOAD" : manageable && reached ? "PROGRESS" : "REPEAT";

  let sets: SetTarget[];
  if (ex.tracking) sets = drillSets(ex.tracking, last, mode);
  else if (ex.type === "WEIGHT_REPS" || ex.type === "WEIGHTED_BODYWEIGHT") sets = weightSets(ex, last, opts, mode);
  else if (ex.type === "BODYWEIGHT_REPS") sets = repsSets(last, mode);
  else if (ex.type === "DURATION_ONLY") sets = timeSets(last, mode);
  else sets = distanceSets(last, mode);

  const reason =
    mode === "DELOAD"
      ? `${deload} A lighter session (about 10% less load or volume) helps you recover and come back stronger.`
      : mode === "PROGRESS"
        ? last.maxRpe !== undefined
          ? `Last time you finished every set with effort at RPE ${last.maxRpe} or easier, so a small step up is due.`
          : "Last time you finished every set, so a small step up is due."
        : manageable
          ? "Some sets last time fell short of the target reps, so repeat them and aim to hit every rep before adding more."
          : `Last time was hard (RPE ${last.maxRpe}), so repeat it and move up once it feels easier.`;
  const facts = `Sessions: ${ss.length}. Plan: ${mode}. ${deload ? `Reason: ${deload} ` : ""}Last effort: ${last.maxRpe ?? "not logged"}. Exercise type: ${ex.tracking ? "sport drill" : ex.type}.`;
  return { kind: mode, sets, reason, facts };
}

/** The target for the n-th working set (the last one is reused for extra sets). */
export function targetForSet(sug: Suggestion, workingIndex: number): SetTarget | undefined {
  if (!sug.sets.length) return undefined;
  return sug.sets[Math.min(workingIndex, sug.sets.length - 1)];
}
