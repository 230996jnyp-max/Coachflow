import { format, parseISO } from "date-fns";
import { guessExercise, matchExercise, type Candidate, type ExerciseGuess, type MatchIndex, type MatchStatus } from "./exerciseMatch";
import type { ParsedExercise, ParsedSet, ParsedWorkout } from "./workoutText";
import type { CompletedWorkoutInput } from "./store";
import type { Exercise, RoutineTemplate, TemplateExercise, UnitSystem } from "./types";
import { fromKg, round, toKg, uid } from "./utils";

/*
 * The editable "import preview": parsed text -> draft rows (all values kept as strings so the coach can type freely)
 * -> routine templates or completed workouts. Weights are shown and typed in the coach's unit and stored in kg.
 */

export interface DraftSet {
  reps: string;
  weight: string;
  duration: string; // minutes
  distance: string; // km
}

export interface DraftExercise {
  key: string;
  raw: string;
  exerciseId: string | null;
  create: ExerciseGuess | null;
  status: MatchStatus | "chosen";
  suggestions: Candidate[];
  timedHint: boolean;
  noSets: boolean;
  mode: "uniform" | "perSet";
  sets: string;
  reps: string;
  weight: string;
  duration: string;
  distance: string;
  perSet: DraftSet[];
  notes: string;
}

export interface DraftWorkout {
  key: string;
  title: string;
  /** yyyy-MM-dd, or "" to use the default date chosen for the import. */
  date: string;
  detected: boolean;
  notes: string;
  exercises: DraftExercise[];
}

const txt = (n: number | undefined, digits = 2) => (n === undefined || n === 0 ? "" : String(round(n, digits)));
const sig = (s: ParsedSet) => `${s.reps ?? ""}|${s.weightKg ?? ""}|${s.durationSec ?? ""}|${s.distanceKm ?? ""}`;

function toDraftSet(s: ParsedSet, unit: UnitSystem): DraftSet {
  return {
    reps: s.reps ? String(s.reps) : "",
    weight: s.weightKg ? txt(fromKg(s.weightKg, unit), 1) : "",
    duration: s.durationSec ? txt(s.durationSec / 60, 2) : "",
    distance: s.distanceKm ? txt(s.distanceKm, 3) : "",
  };
}

export function draftExercise(p: ParsedExercise, index: MatchIndex, unit: UnitSystem): DraftExercise {
  const m = matchExercise(p.raw, index);
  const uniform = p.sets.length > 0 && p.sets.every((s) => sig(s) === sig(p.sets[0]));
  const first = p.sets[0] ?? {};
  const range = !p.noSets && p.repMin !== undefined && p.repMax !== undefined && p.repMin !== p.repMax ? `${p.repMin}-${p.repMax}` : first.reps ? String(first.reps) : "";
  const hasWeight = p.sets.some((s) => s.weightKg);
  return {
    key: uid("dx"),
    raw: p.raw,
    exerciseId: m.best?.id ?? null,
    create: null,
    status: m.status,
    suggestions: m.suggestions,
    timedHint: p.timed,
    noSets: p.noSets,
    mode: uniform || p.sets.length === 0 ? "uniform" : "perSet",
    sets: String(Math.max(1, p.sets.length)),
    reps: range,
    weight: hasWeight && uniform ? txt(fromKg(first.weightKg ?? 0, unit), 1) : "",
    duration: uniform ? txt((first.durationSec ?? 0) / 60, 2) : "",
    distance: uniform ? txt(first.distanceKm, 3) : "",
    perSet: p.sets.map((s) => toDraftSet(s, unit)),
    notes: p.notes,
  };
}

export function buildDrafts(parsed: ParsedWorkout[], index: MatchIndex, unit: UnitSystem): DraftWorkout[] {
  return parsed.map((w) => ({
    key: uid("dw"),
    // A heading-less workout is named after its date, or "Imported workout".
    title: w.title || (w.date ? `Workout ${format(parseISO(w.date), "d MMM")}` : "Imported workout"),
    date: w.date ?? "",
    detected: !!w.date,
    notes: w.notes,
    exercises: w.exercises.map((e) => draftExercise(e, index, unit)),
  }));
}

/** Suggested custom-exercise details for a line the library does not know. */
export function guessFor(d: DraftExercise): ExerciseGuess {
  const hasDistance = d.mode === "uniform" ? Number(d.distance) > 0 : d.perSet.some((s) => Number(s.distance) > 0);
  const hasWeight = d.mode === "uniform" ? Number(d.weight) > 0 : d.perSet.some((s) => Number(s.weight) > 0);
  return guessExercise(d.raw, d.timedHint, hasDistance, hasWeight);
}

export const isResolved = (d: DraftExercise) => !!d.exerciseId || !!d.create;

/* ---------------- Reading the typed values back ---------------- */
function repRange(text: string): { min: number; max: number } | null {
  const m = text.trim().match(/^(\d+)\s*(?:[-–]|to)?\s*(\d+)?$/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}
const n = (s: string) => {
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

export interface ResolvedExercise {
  exerciseId: string;
  type: Exercise["type"] | undefined;
}

type Resolver = (d: DraftExercise) => ResolvedExercise;

/* ---------------- Routine templates ---------------- */
export function draftsToTemplates(drafts: DraftWorkout[], resolve: Resolver, unit: UnitSystem, ownerId: string, shared: boolean): RoutineTemplate[] {
  return drafts
    .filter((w) => w.exercises.length > 0)
    .map((w) => ({
      id: uid("t"),
      ownerId,
      name: (w.title || "Imported routine").slice(0, 120),
      shared,
      exercises: w.exercises.map((d) => {
        const r = resolve(d);
        const timed = r.type === "DURATION_DISTANCE" || r.type === "DURATION_ONLY";
        const te: TemplateExercise = { exerciseId: r.exerciseId, sets: 1, repMin: 0, repMax: 0 };
        const notes = [d.notes];
        if (d.mode === "uniform") {
          te.sets = r.type === "DURATION_DISTANCE" ? 1 : Math.max(1, Math.min(50, Math.round(Number(d.sets)) || 1));
          const range = repRange(d.reps);
          if (range) [te.repMin, te.repMax] = [range.min, range.max];
          else if (!timed) [te.repMin, te.repMax] = [8, 12];
          const w1 = n(d.weight);
          if (w1) te.weight = Math.round(toKg(w1, unit) * 100) / 100;
          const dur = n(d.duration);
          if (dur) te.durationSec = Math.round(dur * 60);
          const dist = n(d.distance);
          if (dist) te.distanceKm = dist;
        } else {
          const rows = d.perSet;
          te.sets = r.type === "DURATION_DISTANCE" ? 1 : Math.max(1, Math.min(50, rows.length));
          const reps = rows.map((s) => Number(s.reps)).filter((x) => x > 0);
          if (reps.length) [te.repMin, te.repMax] = [Math.min(...reps), Math.max(...reps)];
          else if (!timed) [te.repMin, te.repMax] = [8, 12];
          const weights = rows.map((s) => n(s.weight)).filter((x): x is number => x !== undefined);
          if (weights.length) {
            te.weight = Math.round(toKg(weights[weights.length - 1], unit) * 100) / 100;
            notes.push(`Sets: ${rows.map((s) => (n(s.weight) ? `${s.weight}${unit === "metric" ? "kg" : "lb"} x ${s.reps || "?"}` : s.reps || "?")).join(", ")}`);
          }
          const durs = rows.map((s) => n(s.duration)).filter((x): x is number => x !== undefined);
          if (durs.length) te.durationSec = Math.round(durs.reduce((a, b) => a + b, 0) * 60);
          const dists = rows.map((s) => n(s.distance)).filter((x): x is number => x !== undefined);
          if (dists.length) te.distanceKm = Math.round(dists.reduce((a, b) => a + b, 0) * 1000) / 1000;
        }
        const note = notes.filter(Boolean).join("; ").slice(0, 500);
        if (note) te.notes = note;
        return te;
      }),
    }));
}

/* ---------------- Completed workouts ---------------- */
export function draftsToWorkouts(drafts: DraftWorkout[], resolve: Resolver, unit: UnitSystem, clientId: string, defaultDate: string): CompletedWorkoutInput[] {
  return drafts
    .filter((w) => w.exercises.length > 0)
    .map((w, i) => ({
      clientId,
      title: (w.title || "Imported workout").slice(0, 120),
      date: w.date || defaultDate,
      slot: i,
      notes: w.notes.slice(0, 2000),
      exercises: w.exercises.map((d) => {
        const r = resolve(d);
        const rows: DraftSet[] =
          d.mode === "perSet"
            ? d.perSet
            : Array.from({ length: Math.max(1, Math.min(60, Math.round(Number(d.sets)) || 1)) }, () => ({ reps: String(repRange(d.reps)?.max ?? ""), weight: d.weight, duration: d.duration, distance: d.distance }));
        return {
          exerciseId: r.exerciseId,
          notes: d.notes.slice(0, 1000) || undefined,
          sets: rows.map((s) => {
            const weight = n(s.weight);
            const reps = n(s.reps);
            const duration = n(s.duration);
            const distance = n(s.distance);
            return {
              ...(reps ? { reps } : {}),
              ...(weight ? { weight: Math.round(toKg(weight, unit) * 100) / 100 } : {}),
              ...(duration ? { durationSec: Math.round(duration * 60) } : {}),
              ...(distance ? { distanceKm: distance } : {}),
            };
          }),
        };
      }),
    }));
}
