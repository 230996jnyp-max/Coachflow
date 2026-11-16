import { SEED_EXERCISES, exerciseId } from "@/data/exercises";
import { STRENGTH } from "./sports";
import type { AppSettings, DB, RoutineTemplate } from "./types";

/** Bump when the shape of the locally stored (per-device) data changes. */
export const DB_VERSION = 2;

export const DEFAULT_SETTINGS: AppSettings = {
  brandName: "CoachFlow",
  sessionMinutes: 60,
  noticeHours: 12,
  lateCancelCharge: false,
  autoConfirm: true,
  allowCustomGym: true,
  travelEnabled: true,
  travelDefaultMin: 30,
  travelParkingMin: 15,
  travelMaxMin: 90,
  restSeconds: 90,
  emailInvites: true,
  emailChat: true,
};

function tpl(id: string, name: string, items: [string, number, number, number][]): RoutineTemplate {
  return {
    id,
    ownerId: "system",
    name,
    shared: true,
    niche: STRENGTH,
    exercises: items.map(([n, sets, repMin, repMax]) => ({ exerciseId: exerciseId(n), sets, repMin, repMax })),
  };
}

/** Starter routines every coach begins with (they can edit or delete them). */
const STARTER_TEMPLATES: RoutineTemplate[] = [
  tpl("t_push", "Push Day", [
    ["Bench Press (Barbell)", 4, 6, 8],
    ["Incline Bench Press (Dumbbell)", 3, 8, 12],
    ["Shoulder Press (Dumbbell)", 3, 8, 10],
    ["Lateral Raise (Dumbbell)", 3, 12, 15],
    ["Triceps Rope Pushdown", 3, 10, 15],
  ]),
  tpl("t_pull", "Pull Day", [
    ["Pull Up", 4, 6, 10],
    ["Bent Over Row (Barbell)", 4, 8, 10],
    ["Lat Pulldown (Cable)", 3, 10, 12],
    ["Face Pull (Cable)", 3, 12, 15],
    ["Bicep Curl (Dumbbell)", 3, 10, 12],
  ]),
  tpl("t_legs", "Leg Day", [
    ["Squat (Barbell)", 4, 6, 8],
    ["Romanian Deadlift (Barbell)", 3, 8, 10],
    ["Leg Press (Machine)", 3, 10, 12],
    ["Lying Leg Curl (Machine)", 3, 10, 12],
    ["Standing Calf Raise (Machine)", 4, 12, 15],
  ]),
  tpl("t_full", "Full Body Conditioning", [
    ["Goblet Squat (Dumbbell)", 3, 10, 12],
    ["Push Up", 3, 10, 15],
    ["Seated Cable Row", 3, 10, 12],
    ["Romanian Deadlift (Dumbbell)", 3, 10, 12],
    ["Plank", 3, 30, 60],
    ["Treadmill Run", 1, 0, 0],
  ]),
];

/** Fresh copies of the starter routines (created once per coach on the server, never kept on the device). */
export function starterTemplates(): RoutineTemplate[] {
  return STARTER_TEMPLATES.map((t) => ({ ...t, exercises: t.exercises.map((e) => ({ ...e })) }));
}

/**
 * A completely clean dataset: the exercise library only — no demo people,
 * workouts, bookings or photos. Accounts and clients come from the server after login.
 */
export function createEmptyDB(): DB {
  return {
    version: DB_VERSION,
    users: [],
    clients: [],
    exercises: [...SEED_EXERCISES],
    tracking: {},
    workouts: [],
    templates: [],
    metrics: [],
    photos: [],
    gyms: [],
    slots: [],
    bookings: [],
    groups: [],
    groupRequests: [],
    notifications: [],
    assignments: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
