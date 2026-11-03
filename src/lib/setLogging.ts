import { hasTrackedValue } from "./tracking";
import type { Exercise, WorkoutSet } from "./types";

/*
 * Rules for logging one set, shared by the workout logger and gym-floor mode so a set behaves the same everywhere.
 * Pure functions.
 */

/** The values of last time's matching set that fill in whatever the person left empty. */
export function fillFromPrevious(prev: WorkoutSet | undefined, ex: Exercise): Partial<WorkoutSet> {
  if (!prev) return {};
  const p: Partial<WorkoutSet> = {};
  if (ex.tracking) {
    if (prev.custom) p.custom = { ...prev.custom };
    return p;
  }
  if (ex.type === "WEIGHT_REPS" || ex.type === "WEIGHTED_BODYWEIGHT") {
    p.weight = prev.weight;
    p.reps = prev.reps;
  } else if (ex.type === "BODYWEIGHT_REPS") p.reps = prev.reps;
  else if (ex.type === "DURATION_ONLY") p.durationSec = prev.durationSec;
  else {
    p.distanceKm = prev.distanceKm;
    p.durationSec = prev.durationSec;
    p.level = prev.level;
    p.calories = prev.calories;
  }
  return p;
}

/** `set` with every empty field filled from `prev` (what ticking a set does). */
export function withPreviousFilled(set: WorkoutSet, prev: WorkoutSet | undefined, ex: Exercise): WorkoutSet {
  const merged: WorkoutSet = { ...set };
  const fill = fillFromPrevious(prev, ex);
  (Object.keys(fill) as (keyof WorkoutSet)[]).forEach((k) => {
    if (merged[k] === undefined && fill[k] !== undefined) (merged as unknown as Record<string, unknown>)[k] = fill[k];
  });
  return merged;
}

/** Does this set hold enough to be ticked off? */
export function isSetComplete(set: WorkoutSet, ex: Exercise): boolean {
  if (ex.tracking) return hasTrackedValue(set, ex.tracking);
  if (ex.type === "DURATION_ONLY") return !!set.durationSec;
  if (ex.type === "DURATION_DISTANCE") return !!set.durationSec || !!set.distanceKm;
  return !!set.reps && set.reps > 0;
}

/** What to tell the person when the set can't be ticked yet. */
export function missingValueMessage(ex: Exercise): string {
  if (ex.tracking) return "Fill in at least one number or time first.";
  if (ex.type === "DURATION_ONLY") return "Enter a duration first.";
  if (ex.type === "DURATION_DISTANCE") return "Enter a time or distance first.";
  return "Enter reps first.";
}
