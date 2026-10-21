import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, or } from "drizzle-orm";
import { EQUIPMENT, MEASURE_LABELS, MUSCLES, SEED_EXERCISES } from "@/data/exercises";
import { starterTemplates } from "@/lib/seed";
import type { Equipment, Exercise, MeasureType, MuscleGroup, PRKind, RoutineTemplate, SetType, TemplateExercise, Workout, WorkoutExercise, WorkoutSet } from "@/lib/types";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { badRequest, forbidden } from "./http";
import { coachSettings, customExercises, templates, users, workouts, type CustomExerciseRow, type TemplateRow, type UserRow, type WorkoutRow } from "./schema";

/*
 * Training data (workouts, routine templates, custom exercises). Each record is stored as one AES-256-GCM blob bound to
 * its row id; the plain columns are only what is needed to authorise, list and sync. Everything coming from the browser
 * is re-built field by field here, so a client can never store arbitrary JSON.
 */

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const SEED_IDS = new Set(SEED_EXERCISES.map((e) => e.id));
const SET_TYPES: SetType[] = ["N", "W", "D", "F"];
const PR_KINDS: PRKind[] = ["WEIGHT", "E1RM", "VOLUME", "REPS", "TIME", "DISTANCE"];
const MEASURES = Object.keys(MEASURE_LABELS) as MeasureType[];

const aadW = (id: string) => `workout:${id}`;
const aadT = (id: string) => `template:${id}`;
const aadX = (id: string) => `exercise:${id}`;

/* ---------------- Field helpers ---------------- */
function id(v: unknown, name: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw badRequest(`${name} is not valid.`);
  return v;
}
function text(v: unknown, name: string, max: number, required = false): string {
  if (v === undefined || v === null || v === "") {
    if (required) throw badRequest(`${name} is required.`);
    return "";
  }
  if (typeof v !== "string") throw badRequest(`${name} must be text.`);
  const s = v.trim();
  if (required && !s) throw badRequest(`${name} is required.`);
  if (s.length > max) throw badRequest(`${name} is too long.`);
  return s;
}
function num(v: unknown, name: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw badRequest(`${name} is out of range.`);
  return v;
}
function iso(v: unknown, name: string): string {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw badRequest(`${name} is not a valid date.`);
  return new Date(v).toISOString();
}
const arr = (v: unknown, name: string, max: number): unknown[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest(`${name} must be a list.`);
  if (v.length > max) throw badRequest(`${name} has too many items.`);
  return v;
};
const obj = (v: unknown, name: string): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw badRequest(`${name} is not valid.`);
  return v as Record<string, unknown>;
};

/* ---------------- Parsers ---------------- */
function parseSet(raw: unknown): WorkoutSet {
  const r = obj(raw, "Set");
  const type = SET_TYPES.includes(r.type as SetType) ? (r.type as SetType) : "N";
  const pr = Array.isArray(r.pr) ? (r.pr.filter((k): k is PRKind => PR_KINDS.includes(k as PRKind)) as PRKind[]) : undefined;
  const s: WorkoutSet = { id: id(r.id, "Set id"), type, done: r.done === true };
  const weight = num(r.weight, "Weight", 0, 2000);
  const reps = num(r.reps, "Reps", 0, 10000);
  const rpe = num(r.rpe, "RPE", 0, 10);
  const durationSec = num(r.durationSec, "Duration", 0, 172800);
  const distanceKm = num(r.distanceKm, "Distance", 0, 5000);
  const level = num(r.level, "Level", 0, 100);
  const calories = num(r.calories, "Calories", 0, 20000);
  if (weight !== undefined) s.weight = weight;
  if (reps !== undefined) s.reps = reps;
  if (rpe !== undefined) s.rpe = rpe;
  if (durationSec !== undefined) s.durationSec = durationSec;
  if (distanceKm !== undefined) s.distanceKm = distanceKm;
  if (level !== undefined) s.level = level;
  if (calories !== undefined) s.calories = calories;
  if (pr && pr.length) s.pr = pr;
  return s;
}

export function parseWorkout(raw: unknown): Workout {
  const r = obj(raw, "Workout");
  const status = r.status === "ACTIVE" ? "ACTIVE" : "DONE";
  const exercises: WorkoutExercise[] = arr(r.exercises, "Exercises", 80).map((e) => {
    const x = obj(e, "Exercise");
    const we: WorkoutExercise = { id: id(x.id, "Exercise entry id"), exerciseId: id(x.exerciseId, "Exercise id"), sets: arr(x.sets, "Sets", 100).map(parseSet) };
    const notes = text(x.notes, "Exercise notes", 1000);
    if (notes) we.notes = notes;
    return we;
  });
  const w: Workout = {
    id: id(r.id, "Workout id"),
    clientId: id(r.clientId, "Client"),
    title: text(r.title, "Title", 120, true),
    startedAt: iso(r.startedAt, "Workout date"),
    durationSec: num(r.durationSec, "Duration", 0, 172800) ?? 0,
    status,
    gymId: typeof r.gymId === "string" && r.gymId ? text(r.gymId, "Location", 140) : null,
    notes: text(r.notes, "Notes", 4000),
    loggedBy: r.loggedBy === "CLIENT" ? "CLIENT" : "TRAINER",
    loggedById: id(r.loggedById, "Logged by"),
    exercises,
  };
  if (r.liveStartedAt) w.liveStartedAt = iso(r.liveStartedAt, "Start time");
  if (typeof r.templateId === "string" && r.templateId) w.templateId = id(r.templateId, "Template");
  return w;
}

function parseTemplateExercise(raw: unknown): TemplateExercise {
  const r = obj(raw, "Template exercise");
  const t: TemplateExercise = {
    exerciseId: id(r.exerciseId, "Exercise id"),
    sets: Math.round(num(r.sets, "Sets", 0, 50) ?? 1),
    repMin: Math.round(num(r.repMin, "Min reps", 0, 9999) ?? 0),
    repMax: Math.round(num(r.repMax, "Max reps", 0, 9999) ?? 0),
  };
  const weight = num(r.weight, "Weight", 0, 2000);
  const durationSec = num(r.durationSec, "Duration", 0, 172800);
  const distanceKm = num(r.distanceKm, "Distance", 0, 5000);
  const notes = text(r.notes, "Notes", 500);
  if (weight !== undefined && weight > 0) t.weight = weight;
  if (durationSec !== undefined && durationSec > 0) t.durationSec = Math.round(durationSec);
  if (distanceKm !== undefined && distanceKm > 0) t.distanceKm = distanceKm;
  if (notes) t.notes = notes;
  return t;
}

export function parseTemplate(raw: unknown, ownerId: string): RoutineTemplate {
  const r = obj(raw, "Template");
  return {
    id: id(r.id, "Template id"),
    ownerId,
    name: text(r.name, "Name", 120, true),
    shared: r.shared === true,
    ...(r.starter === true ? { starter: true } : {}),
    exercises: arr(r.exercises, "Exercises", 80).map(parseTemplateExercise),
  };
}

export function parseExercise(raw: unknown, ownerId: string): Exercise {
  const r = obj(raw, "Exercise");
  const exId = id(r.id, "Exercise id");
  if (SEED_IDS.has(exId)) throw badRequest("That exercise id is reserved.");
  const primary = r.primary as MuscleGroup;
  const equipment = r.equipment as Equipment;
  const type = r.type as MeasureType;
  if (!MUSCLES.includes(primary)) throw badRequest("Unknown muscle group.");
  if (!EQUIPMENT.includes(equipment)) throw badRequest("Unknown equipment.");
  if (!MEASURES.includes(type)) throw badRequest("Unknown measurement type.");
  const secondary = arr(r.secondary, "Secondary muscles", 8).filter((m): m is MuscleGroup => MUSCLES.includes(m as MuscleGroup) && m !== primary);
  return { id: exId, name: text(r.name, "Name", 100, true), primary, secondary, equipment, type, custom: true, createdBy: ownerId };
}

/* ---------------- Scope ---------------- */
/** The client ids whose workouts `me` may read and write: themselves, plus (for staff) their own clients. */
export async function writableClientIds(me: UserRow): Promise<string[]> {
  if (me.role === "CLIENT") return [me.id];
  const d = await db();
  const rows = await d.select({ id: users.id }).from(users).where(and(eq(users.role, "CLIENT"), eq(users.coachId, me.id)));
  return [me.id, ...rows.map((r) => r.id)];
}

/* ---------------- Row mappers ---------------- */
function openWorkout(row: WorkoutRow): Workout | null {
  try {
    const w = decryptJson<Workout>(row.dataEnc, aadW(row.id));
    return { ...w, id: row.id, clientId: row.clientId, status: row.status === "ACTIVE" ? "ACTIVE" : "DONE" };
  } catch (e) {
    console.error("Could not decrypt workout", row.id, e);
    return null;
  }
}
function openTemplate(row: TemplateRow): RoutineTemplate | null {
  try {
    const t = decryptJson<RoutineTemplate>(row.dataEnc, aadT(row.id));
    return { ...t, id: row.id, ownerId: row.ownerId, shared: row.shared };
  } catch (e) {
    console.error("Could not decrypt template", row.id, e);
    return null;
  }
}
function openExercise(row: CustomExerciseRow): Exercise | null {
  try {
    const x = decryptJson<Exercise>(row.dataEnc, aadX(row.id));
    return { ...x, id: row.id, custom: true, createdBy: row.ownerId };
  } catch (e) {
    console.error("Could not decrypt exercise", row.id, e);
    return null;
  }
}
const present = <T>(v: T | null): v is T => v !== null;

/** Custom exercises `me` can see (their own, their coach's, or their clients'), without loading any workouts. */
export async function customExercisesFor(me: UserRow): Promise<Exercise[]> {
  const d = await db();
  const owners = me.role === "CLIENT" ? [me.id, ...(me.coachId ? [me.coachId] : [])] : await writableClientIds(me);
  const rows = await d.select().from(customExercises).where(inArray(customExercises.ownerId, owners));
  return rows.map(openExercise).filter(present);
}

/* ---------------- Reads ---------------- */
export interface TrainingPayload {
  workouts: Workout[];
  /** Every workout id `me` can see (lets the browser drop ones deleted elsewhere). */
  ids: string[];
  templates: RoutineTemplate[];
  exercises: Exercise[];
  now: string;
}

export async function loadTraining(me: UserRow, since?: Date): Promise<TrainingPayload> {
  const d = await db();
  const clientIds = await writableClientIds(me);

  const idRows = await d.select({ id: workouts.id }).from(workouts).where(inArray(workouts.clientId, clientIds));
  const wRows = since
    ? await d.select().from(workouts).where(and(inArray(workouts.clientId, clientIds), gte(workouts.updatedAt, since)))
    : await d.select().from(workouts).where(inArray(workouts.clientId, clientIds));

  const tRows = await d
    .select()
    .from(templates)
    .where(me.role === "CLIENT" && me.coachId ? or(eq(templates.ownerId, me.id), and(eq(templates.ownerId, me.coachId), eq(templates.shared, true))) : eq(templates.ownerId, me.id));

  const owners = me.role === "CLIENT" ? [me.id, ...(me.coachId ? [me.coachId] : [])] : clientIds;
  const xRows = await d.select().from(customExercises).where(inArray(customExercises.ownerId, owners));

  return {
    workouts: wRows.map(openWorkout).filter(present),
    ids: idRows.map((r) => r.id),
    templates: tRows.map(openTemplate).filter(present),
    exercises: xRows.map(openExercise).filter(present),
    now: new Date().toISOString(),
  };
}

/* ---------------- Writes ---------------- */
export async function putWorkout(me: UserRow, raw: unknown, mode: "upsert" | "insert-only" = "upsert"): Promise<Workout> {
  const w = parseWorkout(raw);
  const allowed = await writableClientIds(me);
  if (!allowed.includes(w.clientId)) throw forbidden("You can't log workouts for this person.");
  const d = await db();
  const [existing] = await d.select({ clientId: workouts.clientId }).from(workouts).where(eq(workouts.id, w.id)).limit(1);
  if (existing) {
    if (mode === "insert-only") return w;
    if (existing.clientId !== w.clientId || !allowed.includes(existing.clientId)) throw forbidden();
  }
  const values = { id: w.id, clientId: w.clientId, startedAt: new Date(w.startedAt), status: w.status, dataEnc: encryptJson(w, aadW(w.id)), updatedAt: new Date() };
  await d.insert(workouts).values(values).onConflictDoUpdate({ target: workouts.id, set: { startedAt: values.startedAt, status: values.status, dataEnc: values.dataEnc, updatedAt: values.updatedAt } });
  return w;
}

export async function removeWorkout(me: UserRow, workoutId: string): Promise<void> {
  const d = await db();
  const [row] = await d.select({ clientId: workouts.clientId }).from(workouts).where(eq(workouts.id, id(workoutId, "Workout id"))).limit(1);
  if (!row) return;
  if (!(await writableClientIds(me)).includes(row.clientId)) throw forbidden();
  await d.delete(workouts).where(eq(workouts.id, workoutId));
}

export async function putTemplate(me: UserRow, raw: unknown, mode: "upsert" | "insert-only" = "upsert"): Promise<RoutineTemplate> {
  const t = parseTemplate(raw, me.id);
  // Only staff share templates with clients.
  if (me.role === "CLIENT") t.shared = false;
  const d = await db();
  const [existing] = await d.select({ ownerId: templates.ownerId }).from(templates).where(eq(templates.id, t.id)).limit(1);
  if (existing) {
    if (mode === "insert-only") return t;
    if (existing.ownerId !== me.id) throw forbidden();
  }
  const values = { id: t.id, ownerId: me.id, shared: t.shared, dataEnc: encryptJson(t, aadT(t.id)), updatedAt: new Date() };
  await d.insert(templates).values(values).onConflictDoUpdate({ target: templates.id, set: { shared: values.shared, dataEnc: values.dataEnc, updatedAt: values.updatedAt } });
  return t;
}

export async function removeTemplate(me: UserRow, templateId: string): Promise<void> {
  const d = await db();
  await d.delete(templates).where(and(eq(templates.id, id(templateId, "Template id")), eq(templates.ownerId, me.id)));
}

export async function putExercise(me: UserRow, raw: unknown, mode: "upsert" | "insert-only" = "upsert"): Promise<Exercise> {
  const x = parseExercise(raw, me.id);
  const d = await db();
  const [existing] = await d.select({ ownerId: customExercises.ownerId }).from(customExercises).where(eq(customExercises.id, x.id)).limit(1);
  if (existing) {
    if (mode === "insert-only") return x;
    if (existing.ownerId !== me.id) throw forbidden();
  }
  const values = { id: x.id, ownerId: me.id, dataEnc: encryptJson(x, aadX(x.id)), updatedAt: new Date() };
  await d.insert(customExercises).values(values).onConflictDoUpdate({ target: customExercises.id, set: { dataEnc: values.dataEnc, updatedAt: values.updatedAt } });
  return x;
}

/** Everything that belongs to a client who is being deleted. */
export async function purgeClientTraining(clientId: string): Promise<void> {
  const d = await db();
  await d.delete(workouts).where(eq(workouts.clientId, clientId));
  await d.delete(templates).where(eq(templates.ownerId, clientId));
  await d.delete(customExercises).where(eq(customExercises.ownerId, clientId));
}

/* ---------------- One-time import of a device's old local data ---------------- */
export interface MigrateBody {
  workouts?: unknown[];
  templates?: unknown[];
  exercises?: unknown[];
  starters?: boolean;
}

export async function migrateLocal(me: UserRow, body: MigrateBody): Promise<{ workouts: number; templates: number; exercises: number; starters: number }> {
  const out = { workouts: 0, templates: 0, exercises: 0, starters: 0 };
  // Custom exercises first, so nothing references an exercise that is not there yet.
  for (const raw of body.exercises ?? []) {
    try {
      await putExercise(me, raw, "insert-only");
      out.exercises++;
    } catch {
      /* skip invalid / reserved entries */
    }
  }
  for (const raw of body.templates ?? []) {
    try {
      const owner = obj(raw, "Template");
      if (owner.ownerId !== me.id) continue;
      await putTemplate(me, raw, "insert-only");
      out.templates++;
    } catch {
      /* skip */
    }
  }
  for (const raw of body.workouts ?? []) {
    try {
      await putWorkout(me, raw, "insert-only");
      out.workouts++;
    } catch {
      /* skip workouts for people this account can't write for */
    }
  }
  if (body.starters && me.role !== "CLIENT") {
    const d = await db();
    await d.insert(coachSettings).values({ coachId: me.id }).onConflictDoNothing();
    const claimed = await d
      .update(coachSettings)
      .set({ templatesSeeded: true })
      .where(and(eq(coachSettings.coachId, me.id), eq(coachSettings.templatesSeeded, false)))
      .returning({ id: coachSettings.coachId });
    if (claimed.length) {
      for (const t of starterTemplates()) {
        await putTemplate(me, { ...t, id: `t_${randomUUID().slice(0, 12)}`, shared: true, starter: true });
        out.starters++;
      }
    }
  }
  return out;
}
