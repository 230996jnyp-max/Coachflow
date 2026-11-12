import { addDays, format, parseISO } from "date-fns";
import type { Assignment, Exercise, TemplateExercise, UnitSystem, Workout } from "./types";
import { fmtClock, fmtWeight } from "./utils";

/*
 * Workouts a coach assigns to a client for a day. Pure helpers (no network): is it done, what state is it in, how to describe the plan,
 * and which dates a "repeat weekly" covers. Dates are plain yyyy-MM-dd days in the viewer's own calendar.
 */

export const MAX_REPEAT_WEEKS = 12;
export const MAX_PER_DAY = 3;

export const dayKey = (d: Date): string => format(d, "yyyy-MM-dd");

export type AssignState = "done" | "today" | "upcoming" | "missed";

/** Done when a finished workout was started from it, or the coach ticked it off by hand. */
export function isAssignmentDone(a: Assignment, workouts: Workout[]): boolean {
  return !!a.doneManually || workouts.some((w) => w.assignmentId === a.id && w.status === "DONE");
}

export function assignmentState(a: Assignment, done: boolean, today: string): AssignState {
  if (done) return "done";
  if (a.date === today) return "today";
  return a.date > today ? "upcoming" : "missed";
}

/** The finished workout that ticked this assignment off, if there is one (for a "view result" link). */
export function resultOf(a: Assignment, workouts: Workout[]): Workout | undefined {
  return workouts.filter((w) => w.assignmentId === a.id && w.status === "DONE").sort((x, y) => y.startedAt.localeCompare(x.startedAt))[0];
}

/** A started (unfinished) workout for this assignment, so the client can resume rather than start a second one. */
export function activeOf(a: Assignment, workouts: Workout[]): Workout | undefined {
  return workouts.find((w) => w.assignmentId === a.id && w.status === "ACTIVE");
}

/** "3 × 8–10 · 40 kg" for strength, "15:00 · 1.4 km" for timed work. */
export function describePlan(te: TemplateExercise, ex: Exercise | undefined, unit: UnitSystem): string {
  const timed = ex?.type === "DURATION_DISTANCE" || ex?.type === "DURATION_ONLY";
  if (timed) {
    const parts: string[] = [];
    if (te.durationSec) parts.push(fmtClock(te.durationSec));
    if (te.distanceKm) parts.push(`${te.distanceKm} km`);
    return parts.length ? parts.join(" · ") : `${te.sets} ${te.sets === 1 ? "round" : "rounds"}`;
  }
  const reps = te.repMin && te.repMax && te.repMin !== te.repMax ? `${te.repMin}–${te.repMax}` : String(te.repMax || te.repMin || "");
  const base = reps ? `${te.sets} × ${reps}` : `${te.sets} ${te.sets === 1 ? "set" : "sets"}`;
  return te.weight ? `${base} · ${fmtWeight(te.weight, unit)}` : base;
}

/** The same day in each of the next `extraWeeks` weeks, starting with the day itself: ["2026-11-12", "2026-11-19", …]. */
export function weeklyDates(date: string, extraWeeks: number): string[] {
  const start = parseISO(date);
  const n = Math.max(0, Math.min(MAX_REPEAT_WEEKS, Math.floor(extraWeeks)));
  return Array.from({ length: n + 1 }, (_, i) => dayKey(addDays(start, 7 * i)));
}

/** Monday of the week a day falls in (yyyy-MM-dd). */
export function weekStartOf(date: Date): Date {
  const idx = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - idx);
}

export function sortAssignments(list: Assignment[]): Assignment[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}
