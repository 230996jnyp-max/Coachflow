import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { SEED_EXERCISES } from "@/data/exercises";
import { CORE_SPORTS, SUB_CATEGORIES, cleanSports, disciplineOf, sportLabel } from "@/lib/sports";
import type { Exercise, RoutineTemplate, TrackingSchema } from "@/lib/types";
import { aiNicheRoutines, aiSportExercises, sanitizeGeneratedExercises, type GeneratedExercise } from "./ai";
import { db } from "./db";
import { HttpError } from "./http";
import { coachSettings, globalExercises, globalTemplates, nicheSeed, type UserRow } from "./schema";
import { putTemplate } from "./training";

/*
 * The shared niche library. A niche is a sport or coaching speciality ("Yoga & Mindful Movement", "Muay Thai" ...). Drills for it are
 * built up to about TARGET once, stored for everybody, and every coach working in that niche (and their clients) gets them.
 */

export const TARGET = 300;
const BATCH = 25;

/** "Muay Thai" and "muay-thai" are the same niche. */
export const nicheKey = (niche: string): string => niche.toLowerCase().replace(/[^a-z0-9]+/g, "");

const parseList = (s: string | null | undefined): string[] => {
  try {
    return cleanSports(JSON.parse(s || "[]"), 40);
  } catch {
    return [];
  }
};
const parseIds = (s: string | null | undefined): string[] => {
  try {
    const v: unknown = JSON.parse(s || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length <= 80).slice(0, 2000) : [];
  } catch {
    return [];
  }
};

/** The proper name for a niche: a built-in sport (by full or short name), a niche that already exists, or the tidied text. */
export async function resolveNiche(name: string): Promise<string> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 50);
  const k = nicheKey(clean);
  if (k.length < 2) throw new HttpError(400, "Please type the name of a sport or coaching niche.");
  const core = CORE_SPORTS.find((s) => nicheKey(s) === k || nicheKey(sportLabel(s)) === k);
  if (core) return core;
  const d = await db();
  const [row] = await d.select({ data: globalExercises.data }).from(globalExercises).where(eq(globalExercises.niche, k)).limit(1);
  if (row) {
    try {
      const disc = (JSON.parse(row.data) as { discipline?: string }).discipline;
      if (disc) return disc;
    } catch {
      /* fall through */
    }
  }
  return clean.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

const builtIn = (niche: string): Exercise[] => SEED_EXERCISES.filter((e) => nicheKey(disciplineOf(e)) === nicheKey(niche));

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
}

function toExercise(niche: string, g: GeneratedExercise): Exercise {
  const k = nicheKey(niche).slice(0, 18);
  const ex: Exercise = {
    id: `gx_${k}_${slug(g.name)}`,
    name: g.name,
    primary: g.primary,
    secondary: g.secondary,
    equipment: g.equipment,
    type: g.type,
    discipline: niche,
    subCategory: g.subCategory,
    global: true,
  };
  if (g.joints.length) ex.joints = g.joints;
  if (g.tissues.length) ex.tissues = g.tissues;
  if (g.tracking) ex.tracking = g.tracking as TrackingSchema;
  return ex;
}

async function insertDrills(niche: string, list: GeneratedExercise[]): Promise<number> {
  if (list.length === 0) return 0;
  const d = await db();
  const rows = list.map((g) => {
    const ex = toExercise(niche, g);
    return { id: ex.id, niche: nicheKey(niche), nameKey: nicheKey(g.name), data: JSON.stringify(ex) };
  });
  const inserted = await d.insert(globalExercises).values(rows).onConflictDoNothing().returning({ id: globalExercises.id });
  return inserted.length;
}

const open = (data: string): Exercise | null => {
  try {
    return JSON.parse(data) as Exercise;
  } catch {
    return null;
  }
};

export interface NicheStatus {
  niche: string;
  count: number;
  target: number;
  done: boolean;
}

export async function nicheStatus(niches: string[]): Promise<NicheStatus[]> {
  const d = await db();
  const out: NicheStatus[] = [];
  for (const niche of niches) {
    const k = nicheKey(niche);
    const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(globalExercises).where(eq(globalExercises.niche, k));
    const [seed] = await d.select().from(nicheSeed).where(eq(nicheSeed.niche, k)).limit(1);
    const count = builtIn(niche).length + Number(n);
    out.push({ niche, count, target: TARGET, done: count >= TARGET || !!seed?.done });
  }
  return out;
}

/** The niches a person works in: a coach's own, or their coach's for a client. */
export async function nichesOf(me: UserRow): Promise<{ coachId: string; niches: string[]; hidden: string[] } | null> {
  const coachId = me.role === "CLIENT" ? me.coachId : me.id;
  if (!coachId) return null;
  const d = await db();
  const [r] = await d.select().from(coachSettings).where(eq(coachSettings.coachId, coachId)).limit(1);
  const niches = [...new Set([...parseList(r?.specialties), ...parseList(r?.sports)])];
  return { coachId, niches, hidden: parseIds(r?.hiddenExercises) };
}

/** Shared drills for these niches (only those added since `since`, if given), without the ones the coach hid. */
export async function globalFor(niches: string[], hidden: string[], since?: Date): Promise<Exercise[]> {
  const keys = [...new Set(niches.map(nicheKey))].filter(Boolean);
  if (keys.length === 0) return [];
  const d = await db();
  const rows = await d
    .select({ id: globalExercises.id, data: globalExercises.data })
    .from(globalExercises)
    .where(since ? and(inArray(globalExercises.niche, keys), gte(globalExercises.createdAt, since)) : inArray(globalExercises.niche, keys));
  const skip = new Set(hidden);
  return rows.flatMap((r) => (skip.has(r.id) ? [] : [open(r.data)].filter((x): x is Exercise => !!x)));
}

/** Every shared drill (for browsing other niches). */
export async function allGlobal(hidden: string[]): Promise<Exercise[]> {
  const d = await db();
  const rows = await d.select({ id: globalExercises.id, data: globalExercises.data }).from(globalExercises);
  const skip = new Set(hidden);
  return rows.flatMap((r) => (skip.has(r.id) ? [] : [open(r.data)].filter((x): x is Exercise => !!x)));
}

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function namesIn(niche: string): Promise<string[]> {
  const d = await db();
  const rows = await d.select({ data: globalExercises.data }).from(globalExercises).where(eq(globalExercises.niche, nicheKey(niche)));
  return [...builtIn(niche).map((e) => e.name), ...rows.map((r) => open(r.data)?.name).filter((n): n is string => !!n)];
}

export interface BatchResult {
  niche: string;
  added: number;
  count: number;
  target: number;
  done: boolean;
  /** Another coach's browser is already building this niche right now. */
  busy?: boolean;
}

/**
 * Adds one batch of drills to a niche (the browser keeps asking until it is done). A short lock means two coaches never build the same
 * niche at once; it stops by itself at TARGET, or when two batches in a row bring (almost) nothing new.
 */
export async function seedBatch(nicheName: string): Promise<BatchResult> {
  const niche = await resolveNiche(nicheName);
  const k = nicheKey(niche);
  const d = await db();
  await d.insert(nicheSeed).values({ niche: k }).onConflictDoNothing();

  const before = (await nicheStatus([niche]))[0];
  const [seed0] = await d.select().from(nicheSeed).where(eq(nicheSeed.niche, k)).limit(1);
  if (before.count >= TARGET || seed0?.done) return { niche, added: 0, count: before.count, target: TARGET, done: true };

  const locked = await d
    .update(nicheSeed)
    .set({ lockedUntil: new Date(Date.now() + 90_000) })
    .where(and(eq(nicheSeed.niche, k), sql`(${nicheSeed.lockedUntil} IS NULL OR ${nicheSeed.lockedUntil} < now())`))
    .returning({ batches: nicheSeed.batches, stale: nicheSeed.stale });
  if (locked.length === 0) return { niche, added: 0, count: before.count, target: TARGET, done: false, busy: true };

  const { batches, stale } = locked[0];
  try {
    const existing = shuffled(await namesIn(niche));
    const emphasis = SUB_CATEGORIES[batches % SUB_CATEGORIES.length];
    const want = Math.min(BATCH, TARGET - before.count + 5);
    const result = await aiSportExercises({ sport: niche, count: want, existing, subCategory: emphasis });
    const added = await insertDrills(niche, result.exercises);
    const nowStale = added < 4 ? stale + 1 : 0;
    const count = before.count + added;
    const done = count >= TARGET || nowStale >= 2;
    await d.update(nicheSeed).set({ lockedUntil: null, batches: batches + 1, stale: nowStale, done }).where(eq(nicheSeed.niche, k));
    return { niche, added, count, target: TARGET, done };
  } catch (e) {
    // Let the next try go ahead soon; a failed batch counts as nothing new only after repeated failures.
    await d.update(nicheSeed).set({ lockedUntil: null, batches: batches + 1 }).where(eq(nicheSeed.niche, k));
    throw e;
  }
}

/** Drills the coach reviewed in the first batch of a new niche. Everything is checked again before it is shared. */
export async function saveReviewed(nicheName: string, raw: unknown): Promise<{ niche: string; added: number; count: number }> {
  const niche = await resolveNiche(nicheName);
  const list = Array.isArray(raw) ? raw.slice(0, 100) : [];
  const existing = await namesIn(niche);
  const clean = sanitizeGeneratedExercises({ exercises: list }, niche, existing).exercises;
  const added = await insertDrills(niche, clean);
  const d = await db();
  await d.insert(nicheSeed).values({ niche: nicheKey(niche) }).onConflictDoNothing();
  return { niche, added, count: (await nicheStatus([niche]))[0].count };
}

/* ---------------- Starter routines ---------------- */
const generating = new Map<string, Promise<void>>();

async function globalRoutines(niche: string): Promise<RoutineTemplate[]> {
  const d = await db();
  const rows = await d.select().from(globalTemplates).where(eq(globalTemplates.niche, nicheKey(niche)));
  return rows.flatMap((r) => {
    try {
      return [JSON.parse(r.data) as RoutineTemplate];
    } catch {
      return [];
    }
  });
}

async function generateRoutines(niche: string): Promise<void> {
  const k = nicheKey(niche);
  const run = async () => {
    if ((await globalRoutines(niche)).length >= 3) return;
    const d = await db();
    const rows = await d.select({ data: globalExercises.data }).from(globalExercises).where(eq(globalExercises.niche, k));
    const pool = [...builtIn(niche), ...rows.map((r) => open(r.data)).filter((x): x is Exercise => !!x)];
    if (pool.length < 8) throw new HttpError(409, "This niche's library is still being built. Try again in a moment.");
    // A spread across the sub-categories, so every routine has real choice.
    const sample = shuffled(pool).slice(0, 160);
    const lib = sample.map((e) => ({ id: e.id, name: e.name }));
    const routines = await aiNicheRoutines(niche, lib, 4);
    const have = new Set((await globalRoutines(niche)).map((r) => r.name.toLowerCase()));
    for (const r of routines) {
      if (have.has(r.name.toLowerCase())) continue;
      const id = `gt_${k.slice(0, 16)}_${randomUUID().slice(0, 8)}`;
      const tpl: RoutineTemplate = { id, ownerId: "system", name: r.name, shared: true, niche, exercises: r.exercises };
      await d.insert(globalTemplates).values({ id, niche: k, data: JSON.stringify(tpl) });
    }
  };
  const pending = generating.get(k) ?? run().finally(() => generating.delete(k));
  generating.set(k, pending);
  await pending;
}

/**
 * Makes sure a coach has 3-5 starter routines for a niche: the shared ones are written once (by AI, from real library drills) and
 * copied to the coach one time per niche, so a routine the coach deletes does not come back.
 */
export async function ensureNicheRoutines(me: UserRow, nicheName: string): Promise<{ niche: string; added: RoutineTemplate[] }> {
  const niche = await resolveNiche(nicheName);
  const k = nicheKey(niche);
  const d = await db();
  await d.insert(coachSettings).values({ coachId: me.id }).onConflictDoNothing();
  const [row] = await d.select({ done: coachSettings.nicheTemplates }).from(coachSettings).where(eq(coachSettings.coachId, me.id)).limit(1);
  const done = parseList(row?.done);
  if (done.some((n) => nicheKey(n) === k)) return { niche, added: [] };

  // Strength & Gym already ships its own starter routines (created for every coach once).
  const isStrength = k === nicheKey(CORE_SPORTS[0]);
  if (!isStrength) await generateRoutines(niche);
  const shared = isStrength ? [] : await globalRoutines(niche);

  // Claim the niche first so two devices never copy the routines twice.
  const claimed = await d
    .update(coachSettings)
    .set({ nicheTemplates: JSON.stringify([...done, niche]) })
    .where(and(eq(coachSettings.coachId, me.id), eq(coachSettings.nicheTemplates, row?.done ?? "[]")))
    .returning({ id: coachSettings.coachId });
  if (claimed.length === 0) return { niche, added: [] };

  const added: RoutineTemplate[] = [];
  for (const t of shared.slice(0, 5)) {
    added.push(await putTemplate(me, { ...t, id: `t_${randomUUID().slice(0, 12)}`, shared: true, starter: true, niche }));
  }
  return { niche, added };
}

/** Hide (or show again) a shared drill for this coach and their clients. */
export async function setHidden(me: UserRow, exerciseId: string, hide: boolean): Promise<string[]> {
  const d = await db();
  await d.insert(coachSettings).values({ coachId: me.id }).onConflictDoNothing();
  const [row] = await d.select({ h: coachSettings.hiddenExercises }).from(coachSettings).where(eq(coachSettings.coachId, me.id)).limit(1);
  const set = new Set(parseIds(row?.h));
  if (hide) set.add(exerciseId);
  else set.delete(exerciseId);
  const list = [...set].slice(0, 2000);
  await d.update(coachSettings).set({ hiddenExercises: JSON.stringify(list) }).where(eq(coachSettings.coachId, me.id));
  return list;
}
