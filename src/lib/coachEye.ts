import { addDays, parseISO } from "date-fns";
import { suggestFor, targetForSet, type SetTarget } from "./progression";
import { annotatePRs, doneWorkouts, formatSet, PR_LABELS, setE1RM, type ExerciseMap } from "./stats";
import type { Booking, ClientProfile, PRKind, UnitSystem, Workout, WorkoutSet } from "./types";
import { availableCredits } from "./scheduling";

/*
 * The coach's 60-second brief for one client: focus and injury notes, last session, records within reach today, credits and
 * attendance. Plain calculations from data the app already holds. Pure functions, shared with the tests.
 */

export interface TopSet {
  exercise: string;
  text: string;
}

export interface ReachItem {
  exerciseId: string;
  exercise: string;
  /** e.g. "30 kg × 9" */
  target: string;
  /** e.g. "Volume PR" */
  beats: string;
}

export interface Eye {
  focuses: string[];
  injury: string;
  last: { date: string; title: string; tops: TopSet[] } | null;
  reach: ReachItem[];
  credits: number;
  groupCredits: number;
  lowCredits: boolean;
  /** Present / (Present + No-show) over the last 90 days, or null when nothing was marked. */
  attendance: number | null;
  attended: number;
  marked: number;
}

export const LOW_CREDITS = 2;

/** The best set of an exercise in a workout (heaviest estimated 1RM, else the longest or the most reps). */
function topSet(sets: WorkoutSet[]): WorkoutSet | undefined {
  const done = sets.filter((s) => s.done && s.type !== "W");
  if (!done.length) return undefined;
  return [...done].sort((a, b) => setE1RM(b) - setE1RM(a) || (b.durationSec ?? 0) - (a.durationSec ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0];
}

/** Attendance over the last 90 days for one client's 1-on-1 sessions. */
export function attendanceRate(bookings: Booking[], clientId: string, now: Date): { rate: number | null; attended: number; marked: number } {
  const since = addDays(now, -90);
  let attended = 0;
  let marked = 0;
  for (const b of bookings) {
    if (b.clientId !== clientId || !b.attendance || parseISO(b.start) < since) continue;
    marked++;
    if (b.attendance.mark === "PRESENT") attended++;
  }
  return { rate: marked ? Math.round((attended / marked) * 100) : null, attended, marked };
}

/**
 * Exercises where today's suggested target would set a personal record: each suggested set is tried as if it were done, and the
 * record check runs on it. `planned` are the exercises coming up today; without a plan, the client's most-done recent exercises.
 */
export function recordsWithinReach(history: Workout[], exMap: ExerciseMap, unit: UnitSystem, planned: string[], max = 3): ReachItem[] {
  const done = doneWorkouts(history);
  let ids = planned.filter((id, i) => planned.indexOf(id) === i);
  if (!ids.length) {
    const counts = new Map<string, number>();
    for (const w of done.slice(-5)) for (const we of w.exercises) counts.set(we.exerciseId, (counts.get(we.exerciseId) ?? 0) + 1);
    ids = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  }
  const out: ReachItem[] = [];
  for (const id of ids) {
    const ex = exMap.get(id);
    if (!ex) continue;
    const sug = suggestFor(ex, done, { unit });
    if (!sug || sug.kind === "DELOAD") continue;
    const t = targetForSet(sug, 0);
    if (!t) continue;
    const hypothetical: Workout = {
      id: "__today",
      clientId: done[0]?.clientId ?? "",
      title: "",
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      durationSec: 0,
      status: "DONE",
      gymId: null,
      notes: "",
      loggedBy: "TRAINER",
      loggedById: "",
      exercises: [{ id: "__e", exerciseId: id, sets: [{ id: "__s", type: "N", done: true, ...(t as SetTarget) } as WorkoutSet] }],
    };
    const flags: PRKind[] = annotatePRs([...done, hypothetical], exMap).get("__s") ?? [];
    if (!flags.length) continue;
    out.push({ exerciseId: id, exercise: ex.name, target: formatSet({ id: "x", type: "N", done: true, ...t } as WorkoutSet, ex, unit), beats: flags.map((f) => `${PR_LABELS[f]} PR`).join(" · ") });
    if (out.length >= max) break;
  }
  return out;
}

export function buildEye(input: { profile: ClientProfile; bookings: Booking[]; workouts: Workout[]; exMap: ExerciseMap; unit: UnitSystem; planned: string[]; now: Date }): Eye {
  const { profile, bookings, workouts, exMap, unit, planned, now } = input;
  const mine = doneWorkouts(workouts, profile.id);
  const lastW = mine[mine.length - 1];
  const tops: TopSet[] = [];
  if (lastW) {
    for (const we of lastW.exercises) {
      const ex = exMap.get(we.exerciseId);
      const s = topSet(we.sets);
      if (ex && s) tops.push({ exercise: ex.name, text: formatSet(s, ex, unit) });
      if (tops.length >= 3) break;
    }
  }
  const credits = availableCredits(profile, bookings);
  const att = attendanceRate(bookings, profile.id, now);
  return {
    focuses: profile.focuses ?? [],
    injury: profile.medicalNotes.trim(),
    last: lastW ? { date: lastW.startedAt, title: lastW.title || "Workout", tops } : null,
    reach: recordsWithinReach(mine, exMap, unit, planned),
    credits,
    groupCredits: profile.groupClassCredits ?? 0,
    lowCredits: credits <= LOW_CREDITS,
    attendance: att.rate,
    attended: att.attended,
    marked: att.marked,
  };
}

/** A short, name-free fact sheet for the optional one-line AI summary (injury detail is never sent, only that there is a note). */
export function eyeFacts(e: Eye, now: Date): string {
  const days = e.last ? Math.max(0, Math.round((now.getTime() - parseISO(e.last.date).getTime()) / 86_400_000)) : null;
  return [
    `Focus: ${e.focuses.length ? e.focuses.join(", ") : "general"}.`,
    `Injury or medical note on file: ${e.injury ? "yes" : "no"}.`,
    days === null ? "No finished workouts yet." : `Last workout ${days} day${days === 1 ? "" : "s"} ago.`,
    `Records within reach today: ${e.reach.length}.`,
    `Session credits left: ${e.credits}${e.lowCredits ? " (low)" : ""}.`,
    e.attendance === null ? "No attendance marked yet." : `Attendance ${e.attendance}% over 90 days.`,
  ].join(" ");
}
