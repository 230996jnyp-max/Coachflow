import { addWeeks, parseISO, startOfWeek } from "date-fns";
import { doneWorkouts, weekStreak, workoutVolume, type ExerciseMap } from "./stats";
import type { Workout } from "./types";

/*
 * Badges: a small, fixed set of milestones, worked out from a client's finished workouts. Nothing is stored: if the workouts are there, the
 * badge is earned, on the day of the workout that crossed the line. Deleting that history takes the badge away with it.
 * The total-weight badges are in kilograms whatever unit the person uses (the numbers are the same for everyone).
 */

export type BadgeKind = "workouts" | "streak" | "pb" | "lifted";

export interface BadgeDef {
  id: string;
  kind: BadgeKind;
  title: string;
  /** What it means, in a sentence. */
  blurb: string;
  emoji: string;
  /** How many workouts / weeks / kilograms it takes (1 for the first personal best). */
  target: number;
}

export const BADGES: readonly BadgeDef[] = [
  { id: "first-workout", kind: "workouts", title: "First workout", blurb: "Logged a very first workout. Everyone starts somewhere.", emoji: "🚀", target: 1 },
  { id: "workouts-10", kind: "workouts", title: "10 workouts", blurb: "Finished 10 workouts.", emoji: "💪", target: 10 },
  { id: "workouts-50", kind: "workouts", title: "50 workouts", blurb: "Finished 50 workouts. This is a habit now.", emoji: "🔥", target: 50 },
  { id: "workouts-100", kind: "workouts", title: "100 workouts", blurb: "Finished 100 workouts.", emoji: "💯", target: 100 },
  { id: "streak-4", kind: "streak", title: "4-week streak", blurb: "Trained at least once a week for 4 weeks in a row.", emoji: "⚡", target: 4 },
  { id: "streak-12", kind: "streak", title: "12-week streak", blurb: "Trained at least once a week for 12 weeks in a row.", emoji: "👑", target: 12 },
  { id: "first-pb", kind: "pb", title: "First personal best", blurb: "Set a new personal record.", emoji: "🥇", target: 1 },
  { id: "lifted-1000", kind: "lifted", title: "1,000 kg lifted", blurb: "Lifted 1,000 kg in total across all workouts.", emoji: "🏋️", target: 1000 },
  { id: "lifted-10000", kind: "lifted", title: "10,000 kg lifted", blurb: "Lifted 10,000 kg in total across all workouts.", emoji: "🏗️", target: 10000 },
];

export interface BadgeStatus {
  def: BadgeDef;
  /** The date (ISO) of the workout that earned it; null while it is still locked. */
  earnedAt: string | null;
  /** The workout that earned it. */
  workoutId: string | null;
  /** How far along a locked badge is (for an earned one, current = target). */
  current: number;
}

/** Which Monday-start week a workout belongs to. */
const weekKey = (w: Workout) => startOfWeek(parseISO(w.startedAt), { weekStartsOn: 1 }).getTime();

/**
 * Every badge for one client, earned or not. `workouts` may hold anyone's (only `clientId`'s finished ones count).
 * Streak badges are for the first time a run of that many weeks was reached, so breaking the streak later does not take it away.
 */
export function badgeStatuses(workouts: Workout[], exMap: ExerciseMap, clientId: string, now: Date): BadgeStatus[] {
  const done = doneWorkouts(workouts, clientId);

  // Workouts: the Nth finished workout.
  // Total weight: the workout that took the running total over the line.
  const volumeAt: { w: Workout; total: number }[] = [];
  let total = 0;
  for (const w of done) {
    total += workoutVolume(w, exMap);
    volumeAt.push({ w, total });
  }

  // Streaks: the first workout of the week in which a run of N weeks was reached.
  const firstOfWeek = new Map<number, Workout>();
  for (const w of done) if (!firstOfWeek.has(weekKey(w))) firstOfWeek.set(weekKey(w), w);
  const weeks = [...firstOfWeek.keys()].sort((a, b) => a - b);
  const reached = new Map<number, Workout>(); // run length -> the workout that reached it first
  let run = 0;
  let prev = 0;
  for (const wk of weeks) {
    run = prev && addWeeks(new Date(prev), 1).getTime() === wk ? run + 1 : 1;
    prev = wk;
    if (!reached.has(run)) reached.set(run, firstOfWeek.get(wk)!);
  }
  const streakNow = weekStreak(done, now);

  // First personal best: the first finished set that carries a record.
  const pbWorkout = done.find((w) => w.exercises.some((we) => we.sets.some((s) => s.done && s.pr?.length)));

  return BADGES.map((def): BadgeStatus => {
    let hit: Workout | undefined;
    let current = 0;
    if (def.kind === "workouts") {
      hit = done[def.target - 1];
      current = done.length;
    } else if (def.kind === "streak") {
      hit = reached.get(def.target);
      current = streakNow;
    } else if (def.kind === "pb") {
      hit = pbWorkout;
      current = pbWorkout ? 1 : 0;
    } else {
      hit = volumeAt.find((v) => v.total >= def.target)?.w;
      current = total;
    }
    return hit ? { def, earnedAt: hit.startedAt, workoutId: hit.id, current: def.target } : { def, earnedAt: null, workoutId: null, current: Math.min(current, def.target) };
  });
}

/** The badges a single workout earned (what to celebrate when it is finished). */
export const earnedIn = (statuses: BadgeStatus[], workoutId: string): BadgeStatus[] => statuses.filter((s) => s.workoutId === workoutId);

/** "3 of 9" style progress for a locked badge, 0 to 100. */
export const badgePercent = (s: BadgeStatus): number => (s.earnedAt ? 100 : Math.max(0, Math.min(99, Math.floor((s.current / s.def.target) * 100))));

/** What is left to do, in words ("6 more workouts", "2 more weeks", "480 kg to go"). */
export function badgeLeft(s: BadgeStatus): string {
  const left = Math.max(0, s.def.target - s.current);
  switch (s.def.kind) {
    case "workouts":
      return `${left} more ${left === 1 ? "workout" : "workouts"}`;
    case "streak":
      return `${left} more ${left === 1 ? "week" : "weeks"} in a row`;
    case "pb":
      return "Beat your best on any exercise";
    case "lifted":
      return `${Math.ceil(left).toLocaleString("en-US")} kg to go`;
  }
}
