import { suggestFor, targetForSet } from "./progression";
import { fillFromPrevious } from "./setLogging";
import { findPrevious, workoutSetCount } from "./stats";
import type { DB, Exercise, GroupMember, GroupSession, RoutineTemplate, UnitSystem, Workout, WorkoutExercise, WorkoutSet } from "./types";

/*
 * Gym-floor mode: the coach runs a live session (a 1-on-1, a partner session or a class) for several people from one screen.
 * Everything here is pure (no store, no network) so it is shared by the screen and the tests.
 */

/** How long before the start a session can be opened on the floor, and how long after the end it still shows as running. */
export const FLOOR_LEAD_MIN = 60;
export const FLOOR_TAIL_MIN = 120;

export interface FloorParticipant {
  clientId: string;
  role: "OWNER" | "MEMBER";
}

export interface FloorSession {
  /** What the address carries: a class / partner-session id, or a 1-on-1 booking id. */
  key: string;
  /** What attendance and credits are settled against. */
  kind: "BOOKING" | "GROUP";
  targetId: string;
  groupId?: string;
  bookingId?: string;
  title: string;
  start: string;
  end: string;
  participants: FloorParticipant[];
  /** The class routine, when the coach attached one. */
  templateId?: string;
  finalized: boolean;
  cancelled: boolean;
  /** A booking still waiting for approval can't be run yet. */
  pending: boolean;
  /** The coach can add another client on the spot (not for a private home session, nor for a full class). */
  canWalkIn: boolean;
  gymId: string | null;
}

const LIVE_MEMBER = new Set<GroupMember["status"]>(["CONFIRMED", "ATTENDED"]);

function fromGroup(g: GroupSession): FloorSession {
  const members = (g.members ?? []).filter((m) => LIVE_MEMBER.has(m.status));
  // The session owner of a partner session first, then the others in the order they joined.
  const ordered = [...members].sort((a, b) => (a.role === b.role ? a.joinedAt.localeCompare(b.joinedAt) : a.role === "OWNER" ? -1 : 1));
  return {
    key: g.id,
    kind: "GROUP",
    targetId: g.id,
    groupId: g.id,
    bookingId: g.bookingId,
    title: g.title,
    start: g.start,
    end: g.end,
    participants: ordered.map((m) => ({ clientId: m.clientId, role: m.role })),
    templateId: g.templateId,
    finalized: g.status === "COMPLETED",
    cancelled: g.status === "CANCELLED",
    pending: false,
    canWalkIn: g.status === "OPEN" && g.confirmed < g.capacity && !(g.place?.home ?? false),
    gymId: g.gymId,
  };
}

/** The live session an address points at (a class or partner-session id, or a 1-on-1 booking id), or null. */
export function resolveFloorSession(db: Pick<DB, "bookings" | "groups">, key: string): FloorSession | null {
  const group = db.groups.find((g) => g.id === key);
  if (group) return fromGroup(group);
  const b = db.bookings.find((x) => x.id === key);
  if (!b) return null;
  // A 1-on-1 that was opened to partners runs as that partner session.
  const shared = db.groups.find((g) => g.bookingId === b.id && g.status !== "CANCELLED");
  if (shared) return fromGroup(shared);
  return {
    key: b.id,
    kind: "BOOKING",
    targetId: b.id,
    bookingId: b.id,
    title: b.focus ? `1-on-1 · ${b.focus}` : "1-on-1 session",
    start: b.start,
    end: b.end,
    participants: [{ clientId: b.clientId, role: "OWNER" }],
    finalized: b.status === "COMPLETED" || b.status === "NO_SHOW",
    cancelled: b.status === "CANCELLED" || b.status === "DECLINED",
    pending: b.status === "PENDING",
    canWalkIn: b.status === "CONFIRMED" && !(b.place?.home ?? false),
    gymId: b.gymId,
  };
}

/**
 * Sessions the coach can run right now or soon: starting within the hour (or already under way), not finished, not cancelled.
 * A 1-on-1 opened to partners appears once, as the partner session.
 */
export function floorSessions(db: Pick<DB, "bookings" | "groups">, now: Date): FloorSession[] {
  const from = now.getTime() - FLOOR_TAIL_MIN * 60000;
  const to = now.getTime() + FLOOR_LEAD_MIN * 60000;
  const out: FloorSession[] = [];
  const seen = new Set<string>();
  for (const g of db.groups) {
    if (g.status !== "OPEN") continue;
    const s = fromGroup(g);
    if (!s.participants.length) continue;
    out.push(s);
    seen.add(g.id);
    if (g.bookingId) seen.add(g.bookingId);
  }
  for (const b of db.bookings) {
    if (b.status !== "CONFIRMED" || seen.has(b.id)) continue;
    const s = resolveFloorSession(db, b.id);
    if (s) out.push(s);
  }
  return out
    .filter((s) => !s.finalized && !s.cancelled && !s.pending && Date.parse(s.end) > from && Date.parse(s.start) < to)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** The session to point the coach at first: one that is running now, otherwise the next to start. */
export function nextFloorSession(db: Pick<DB, "bookings" | "groups">, now: Date): FloorSession | null {
  const list = floorSessions(db, now);
  return list.find((s) => Date.parse(s.start) <= now.getTime() && Date.parse(s.end) > now.getTime()) ?? list[0] ?? null;
}

/* ---------------- Workouts ---------------- */
const bare = (id: string) => id.replace(/^[a-z]{1,3}_/, "");

/**
 * One fixed id per person per session, so two devices (or a reload) never create the workout twice. Class workouts use the id the
 * server gives a pushed class workout; the id of a 1-on-1 workout drops the id prefixes to stay well inside the 80-character limit.
 */
export function floorWorkoutId(s: FloorSession, clientId: string): string {
  return s.groupId ? `gw_${s.groupId}_${clientId}` : `bw_${bare(s.bookingId ?? "")}_${bare(clientId)}`;
}

/** This person's workout for the session, whichever way it was made (pushed to the class, or started on the floor). */
export function laneWorkout(workouts: Workout[], s: FloorSession, clientId: string): Workout | undefined {
  return workouts.find((w) => w.clientId === clientId && ((!!s.groupId && w.groupId === s.groupId) || (!!s.bookingId && w.bookingId === s.bookingId)));
}

/**
 * The routine a person starts with: the class routine for a class, otherwise the routine of their last finished session
 * (while it still exists). Nothing otherwise: the coach picks one, or starts empty.
 */
export function defaultTemplateId(db: Pick<DB, "workouts" | "templates">, s: FloorSession, clientId: string): string | undefined {
  if (s.templateId && db.templates.some((t) => t.id === s.templateId)) return s.templateId;
  const last = [...db.workouts]
    .filter((w) => w.clientId === clientId && w.status === "DONE" && w.templateId && db.templates.some((t) => t.id === w.templateId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return last?.templateId;
}

export interface PrefillInput {
  clientId: string;
  /** Everything known about this client (their finished workouts are used for "suggested today" and last-time values). */
  workouts: Workout[];
  exMap: Map<string, Exercise>;
  unit: UnitSystem;
  newId: (prefix: string) => string;
}

export interface BuildInput extends PrefillInput {
  session: FloorSession;
  coachId: string;
  template?: RoutineTemplate;
  now: Date;
  gymId: string | null;
}

/** Sets for one exercise, pre-filled with today's suggestion, else last time's numbers, else the routine's targets. */
function prefilledExercise(i: PrefillInput, te: RoutineTemplate["exercises"][number], w: Workout): WorkoutExercise {
  const ex = i.exMap.get(te.exerciseId);
  const count = ex?.type === "DURATION_DISTANCE" ? 1 : Math.max(1, te.sets || 1);
  const history = i.workouts.filter((x) => x.clientId === i.clientId && x.status === "DONE");
  const sug = ex ? suggestFor(ex, history, { unit: i.unit, repMin: te.repMax > 0 ? te.repMin : undefined, repMax: te.repMax > 0 ? te.repMax : undefined }) : null;
  const prev = ex ? findPrevious(history, w, te.exerciseId) : undefined;
  const prevSets = (prev?.sets ?? []).filter((s) => s.type !== "W" && s.done);
  const timed = ex?.type === "DURATION_DISTANCE" || ex?.type === "DURATION_ONLY";
  const sets: WorkoutSet[] = Array.from({ length: count }, (_, k) => {
    const set: WorkoutSet = { id: i.newId("s"), type: "N", done: false };
    const target = sug ? targetForSet(sug, k) : undefined;
    if (target) {
      if (target.weight !== undefined) set.weight = target.weight;
      if (target.reps !== undefined) set.reps = target.reps;
      if (target.durationSec !== undefined) set.durationSec = target.durationSec;
      if (target.distanceKm !== undefined) set.distanceKm = target.distanceKm;
      if (target.custom) set.custom = { ...target.custom };
      return set;
    }
    const p = ex ? (prevSets[k] ?? prevSets[prevSets.length - 1]) : undefined;
    if (p && ex) return { ...set, ...fillFromPrevious(p, ex), id: set.id, type: "N", done: false };
    // First time with this exercise: the routine's own targets (when it has any).
    if (timed) {
      if (te.durationSec) set.durationSec = te.durationSec;
      if (te.distanceKm) set.distanceKm = te.distanceKm;
    } else if (te.weight) {
      set.weight = te.weight;
      const reps = te.repMax || te.repMin;
      if (reps) set.reps = reps;
    }
    return set;
  });
  return { id: i.newId("we"), exerciseId: te.exerciseId, ...(te.notes ? { notes: te.notes } : {}), sets };
}

/** Entries for exercises the coach adds on the spot, pre-filled the same way as a routine's. */
export function prefillExercises(exerciseIds: string[], w: Workout, i: PrefillInput): WorkoutExercise[] {
  return exerciseIds.map((exerciseId) => prefilledExercise(i, { exerciseId, sets: 3, repMin: 0, repMax: 0 }, w));
}

/** A new live workout for one person in the session, pre-filled and linked to the session. */
export function buildFloorWorkout(i: BuildInput): Workout {
  const iso = i.now.toISOString();
  const w: Workout = {
    id: floorWorkoutId(i.session, i.clientId),
    clientId: i.clientId,
    title: i.template?.name ?? i.session.title,
    startedAt: iso,
    liveStartedAt: iso,
    durationSec: 0,
    status: "ACTIVE",
    gymId: i.gymId,
    notes: "",
    loggedBy: "TRAINER",
    loggedById: i.coachId,
    ...(i.template ? { templateId: i.template.id } : {}),
    ...(i.session.groupId ? { groupId: i.session.groupId } : {}),
    ...(i.session.bookingId && !i.session.groupId ? { bookingId: i.session.bookingId } : {}),
    exercises: [],
  };
  w.exercises = (i.template?.exercises ?? []).map((te) => prefilledExercise(i, te, w));
  return w;
}

/** The same routine laid onto an existing live workout (the coach changed the routine for one person). Logged sets are kept. */
export function applyRoutine(w: Workout, template: RoutineTemplate, i: PrefillInput): Workout {
  const probe = { ...w, exercises: [] as WorkoutExercise[] };
  const fresh = template.exercises.map((te) => prefilledExercise(i, te, probe));
  const kept = w.exercises.filter((we) => we.sets.some((s) => s.done));
  const keptIds = new Set(kept.map((we) => we.exerciseId));
  return { ...w, title: template.name, templateId: template.id, exercises: [...kept, ...fresh.filter((we) => !keptIds.has(we.exerciseId))] };
}

/* ---------------- Progress, notes and ending ---------------- */
export interface LaneProgress {
  done: number;
  total: number;
  prs: number;
}

export function laneProgress(w: Workout | undefined): LaneProgress {
  if (!w) return { done: 0, total: 0, prs: 0 };
  let total = 0;
  let prs = 0;
  for (const we of w.exercises)
    for (const s of we.sets) {
      total++;
      if (s.done && s.pr?.length) prs++;
    }
  return { done: workoutSetCount(w), total, prs };
}

/** The coach's note from this person's most recent earlier session (shown at the top of their lane next time). */
export function lastCoachNote(workouts: Workout[], clientId: string, excludeId?: string): { note: string; at: string } | null {
  const w = [...workouts]
    .filter((x) => x.clientId === clientId && x.id !== excludeId && x.coachNote && x.status === "DONE")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return w?.coachNote ? { note: w.coachNote, at: w.startedAt } : null;
}

export type EndMark = "PRESENT" | "NO_SHOW";

export interface EndRow {
  clientId: string;
  workoutId?: string;
  doneSets: number;
  /** What to start from: Present for anyone who logged sets; nothing logged means the coach has to say. */
  suggested: EndMark | null;
}

export function endPlan(participants: FloorParticipant[], workouts: Workout[], s: FloorSession): EndRow[] {
  return participants.map((p) => {
    const w = laneWorkout(workouts, s, p.clientId);
    const doneSets = w ? workoutSetCount(w) : 0;
    return { clientId: p.clientId, workoutId: w?.id, doneSets, suggested: doneSets > 0 ? "PRESENT" : null };
  });
}

/** Minutes until the session starts (negative once it has started). */
export const minutesToStart = (s: Pick<FloorSession, "start">, now: Date) => Math.round((Date.parse(s.start) - now.getTime()) / 60000);
