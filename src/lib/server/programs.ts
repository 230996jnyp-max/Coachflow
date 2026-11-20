import "server-only";
import { randomUUID } from "node:crypto";
import { format, parseISO } from "date-fns";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { SEED_EXERCISES } from "@/data/exercises";
import { allowedLibrary, buildBasicPlan, profileTags, sanitizePlan, weekStartOf as mondayOf, type CoachRule, type TrainerEquipment, type TrainerPlan } from "@/lib/aiTrainer";
import { rulesToPrompt } from "@/lib/aiReview";
import { screen } from "@/lib/aiTrainer";
import type { GoalsData, ParqData } from "@/lib/intakeForms";
import { dayKey } from "@/lib/assignments";
import {
  applyOps,
  cleanOps,
  cleanSlots,
  copyWeek,
  describeProgram,
  expandWeeks,
  exerciseIdsOf,
  MAX_EDITS,
  MAX_NAME,
  MAX_WEEKS,
  programEnd,
  slotDate,

  type Op,
  type Program,
  type ProgramSlot,
  type ProgressionMode,
} from "@/lib/programs";
import { parseProgramText, type ProgramImport } from "@/lib/programImport";
import { buildIndex } from "@/lib/exerciseMatch";
import { STARTERS, starterSlots } from "@/lib/starterPrograms";
import type { Exercise, TemplateExercise, Workout } from "@/lib/types";
import { isMinorRow, loadClientFor, openProfile } from "./accounts";
import { aiConfigured, groq, jsonFrom, TEXT_MODEL } from "./ai";
import { logAiUsage } from "./aiLog";
import { refundAiQuota, takeAiQuota } from "./aiQuota";
import { activeRules, soloSafety } from "./aiTrainer";
import { FUTURE_DAYS, insertPlanRow, MAX_PER_CLIENT, openPlan, rewritePlanRow, shift, type Plan, type ProgRef } from "./assignments";
import { realDate } from "./bodyData";
import { decryptJson, encryptJson } from "./crypto";
import { db, isLocalTestMode } from "./db";
import { notify } from "./groups";
import { badRequest, forbidden, notFound, str } from "./http";
import { intakeFor } from "./intake";
import { requireAdult } from "./minors";
import { hit } from "./rateLimit";
import { assignments, users, type UserRow } from "./schema";
import { programEnrolments, programs, programSuggestions } from "./schemaFlow";
import { customExercisesFor, recentDoneWorkouts } from "./training";

/*
 * Programs for coaches and for people training on their own. A program is stored encrypted, bound to its row. Giving one to a client
 * (an "enrolment") writes ordinary assignments, one per workout, each marked with the enrolment, so everything already built on
 * assignments (the plan calendar, Today's workout, the training score, missed-workout nudges) works for programs without change.
 *
 * Nothing reaches a client until the coach presses Assign. Live Sync only ever touches days after today, never a day the coach changed
 * by hand, and never a workout the client has already done.
 */

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const aad = (id: string) => `program:${id}`;
const MAX_PROGRAMS = 100;
const MAX_SOLO_PROGRAMS = 5;
const MAX_SLOTS = 252;

interface Stored {
  name: string;
  description: string;
  goal: string;
  level: string;
  source: Program["source"];
  gentle: boolean;
  minor: boolean;
  progression: ProgressionMode;
  slots: ProgramSlot[];
  edits: number;
  /** The program before the last chat edit, so it can be undone. */
  undo?: { weeks: number; slots: ProgramSlot[]; label: string };
}

type Row = typeof programs.$inferSelect;

const aiOn = (): boolean => aiConfigured() && !(isLocalTestMode() && (process.env.AI_TRAINER_DISABLE === "1" || process.env.PROGRAMS_AI_DISABLE === "1"));
export const programAiAvailable = aiOn;

const isStaff = (me: UserRow) => me.role === "OWNER" || me.role === "COACH";
export const isSolo = (me: Pick<UserRow, "role" | "coachId">) => me.role === "CLIENT" && !me.coachId;

/** Coaches and owners, and people training on their own (adults). A coach's client gets programs from their coach, not for themselves. */
export function requireBuilder(me: UserRow): void {
  if (isStaff(me)) return;
  if (isSolo(me)) return requireAdult(me);
  throw forbidden("Programs are made by your coach.");
}

function open(row: Row): Program | null {
  try {
    const s = decryptJson<Stored>(row.dataEnc, aad(row.id));
    return {
      id: row.id,
      ownerId: row.ownerId,
      name: s.name,
      description: s.description,
      weeks: row.weeks,
      goal: s.goal,
      level: s.level,
      source: s.source,
      gentle: s.gentle,
      minor: s.minor,
      slots: s.slots,
      edits: s.edits,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(s.undo ? { canUndo: true } : {}),
    };
  } catch (e) {
    console.error("Could not decrypt program", row.id, e);
    return null;
  }
}

const storedOf = (p: Program, undo?: Stored["undo"]): Stored => ({
  name: p.name,
  description: p.description,
  goal: p.goal,
  level: p.level,
  source: p.source,
  gentle: p.gentle,
  minor: p.minor,
  progression: "reps_then_weight",
  slots: p.slots,
  edits: p.edits,
  ...(undo ? { undo } : {}),
});

async function ownRow(me: UserRow, id: string): Promise<{ row: Row; program: Program; undo?: Stored["undo"] }> {
  requireBuilder(me);
  if (!ID_RE.test(id)) throw notFound("That program is gone.");
  const d = await db();
  const [row] = await d.select().from(programs).where(eq(programs.id, id)).limit(1);
  if (!row || row.ownerId !== me.id) throw notFound("That program is gone.");
  const program = open(row);
  if (!program) throw notFound("That program is gone.");
  let undo: Stored["undo"];
  try {
    undo = decryptJson<Stored>(row.dataEnc, aad(row.id)).undo;
  } catch {
    undo = undefined;
  }
  return { row, program, undo };
}

async function save(me: UserRow, p: Program, opts: { bump?: boolean; undo?: Stored["undo"] | null; keepUndo?: Stored["undo"] } = {}): Promise<Program> {
  const d = await db();
  const undo = opts.undo === null ? undefined : (opts.undo ?? opts.keepUndo);
  const dataEnc = encryptJson(storedOf(p, undo), aad(p.id));
  const [row] = await d
    .update(programs)
    .set({ weeks: p.weeks, dataEnc, ...(opts.bump === false ? {} : { version: sql`${programs.version} + 1` }), updatedAt: new Date() })
    .where(and(eq(programs.id, p.id), eq(programs.ownerId, me.id)))
    .returning();
  const out = row ? open(row) : null;
  if (!out) throw notFound("That program is gone.");
  return out;
}

async function insertProgram(me: UserRow, p: Omit<Program, "id" | "ownerId" | "version" | "createdAt" | "updatedAt" | "edits">): Promise<Program> {
  const d = await db();
  const cap = isSolo(me) ? MAX_SOLO_PROGRAMS : MAX_PROGRAMS;
  const [{ n }] = await d.select({ n: count() }).from(programs).where(eq(programs.ownerId, me.id));
  if (Number(n) >= cap) throw badRequest(isSolo(me) ? `You can keep ${cap} programs. Delete one first.` : `You can keep ${cap} programs. Delete one you no longer use first.`);
  const id = `pg_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const full: Program = { ...p, id, ownerId: me.id, edits: 0, version: 1, createdAt: "", updatedAt: "" };
  const [row] = await d.insert(programs).values({ id, ownerId: me.id, weeks: p.weeks, dataEnc: encryptJson(storedOf(full), aad(id)) }).returning();
  const out = open(row);
  if (!out) throw badRequest("Could not save the program.");
  return out;
}

/* ---------------- Library ---------------- */
async function libraryFor(me: UserRow): Promise<Exercise[]> {
  const custom = isStaff(me) ? await customExercisesFor(me) : [];
  const seen = new Set(SEED_EXERCISES.map((e) => e.id));
  return [...SEED_EXERCISES, ...custom.filter((e) => !seen.has(e.id))];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/* ---------------- Lists, reads, plain edits ---------------- */
export interface ProgramSummary {
  id: string;
  name: string;
  description: string;
  weeks: number;
  goal: string;
  level: string;
  source: Program["source"];
  gentle: boolean;
  summary: string;
  slotCount: number;
  activeClients: number;
  updatedAt: string;
}

export async function listPrograms(me: UserRow): Promise<ProgramSummary[]> {
  requireBuilder(me);
  const d = await db();
  const rows = await d.select().from(programs).where(eq(programs.ownerId, me.id)).orderBy(desc(programs.updatedAt)).limit(MAX_PROGRAMS);
  const active = await d.select({ programId: programEnrolments.programId, n: count() }).from(programEnrolments).where(and(eq(programEnrolments.ownerId, me.id), eq(programEnrolments.status, "ACTIVE"))).groupBy(programEnrolments.programId);
  const byProgram = new Map(active.map((a) => [a.programId, Number(a.n)]));
  const out: ProgramSummary[] = [];
  for (const row of rows) {
    const p = open(row);
    if (!p) continue;
    out.push({ id: p.id, name: p.name, description: p.description, weeks: p.weeks, goal: p.goal, level: p.level, source: p.source, gentle: p.gentle, summary: describeProgram(p), slotCount: p.slots.length, activeClients: byProgram.get(p.id) ?? 0, updatedAt: p.updatedAt });
  }
  return out;
}

export async function getProgram(me: UserRow, id: string): Promise<Program> {
  return (await ownRow(me, id)).program;
}

function fields(body: Record<string, unknown>) {
  return {
    name: str(body.name, "Name", { min: 1, max: MAX_NAME }),
    description: str(body.description, "Description", { optional: true, max: 600 }),
    goal: str(body.goal, "Goal", { optional: true, max: 60 }),
    level: str(body.level, "Level", { optional: true, max: 40 }),
  };
}

function weeksOf(v: unknown, fallback = 4): number {
  const n = v === undefined || v === null || v === "" ? fallback : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_WEEKS) throw badRequest(`A program runs for 1 to ${MAX_WEEKS} weeks.`);
  return n;
}

/** New program: blank (name and weeks, no workouts yet), or with workouts (an import or a copy). */
export async function createProgram(me: UserRow, body: Record<string, unknown>): Promise<Program> {
  requireBuilder(me);
  await hit(`prog-new:${me.id}`, 40, 3_600_000, "You've made a lot of programs this hour. Try again a little later.");
  const f = fields(body);
  const weeks = weeksOf(body.weeks);
  const gentle = body.gentle === true;
  let slots: ProgramSlot[] = [];
  if (Array.isArray(body.slots) && body.slots.length) {
    const r = cleanSlots(body.slots, weeks, { gentle });
    if ("error" in r) throw badRequest(r.error);
    slots = r.slots;
  }
  const source = body.source === "import" ? "import" : "manual";
  return insertProgram(me, { ...f, weeks, source, gentle, minor: false, slots });
}

/** Saves changes from the planner: name, notes and the workouts. Bumps the version and brings Live Sync clients up to date. */
export async function updateProgram(me: UserRow, id: string, body: Record<string, unknown>): Promise<{ program: Program; synced: number }> {
  const { program: cur, undo } = await ownRow(me, id);
  await hit(`prog-save:${me.id}`, 240, 3_600_000, "You've saved a lot of changes this hour. Try again a little later.");
  const next: Program = { ...cur };
  if (body.name !== undefined) next.name = str(body.name, "Name", { min: 1, max: MAX_NAME });
  if (body.description !== undefined) next.description = str(body.description, "Description", { optional: true, max: 600 });
  if (body.goal !== undefined) next.goal = str(body.goal, "Goal", { optional: true, max: 60 });
  if (body.level !== undefined) next.level = str(body.level, "Level", { optional: true, max: 40 });
  if (body.weeks !== undefined) next.weeks = weeksOf(body.weeks, cur.weeks);
  if (body.slots !== undefined) {
    if (Array.isArray(body.slots) && body.slots.length === 0) next.slots = [];
    else {
      const r = cleanSlots(body.slots, next.weeks, { gentle: cur.gentle, minor: cur.minor });
      if ("error" in r) throw badRequest(r.error);
      next.slots = r.slots;
    }
  }
  next.slots = next.slots.filter((s) => s.week <= next.weeks);
  if (next.slots.length > MAX_SLOTS) throw badRequest("That is more workouts than a program can hold.");
  const saved = await save(me, next, { keepUndo: undo });
  const synced = await syncProgram(saved.id);
  return { program: saved, synced };
}

export async function duplicateProgram(me: UserRow, id: string): Promise<Program> {
  const { program } = await ownRow(me, id);
  await hit(`prog-new:${me.id}`, 40, 3_600_000, "You've made a lot of programs this hour. Try again a little later.");
  const slots = program.slots.map((s) => ({ ...s, id: `ps_${randomUUID().replace(/-/g, "").slice(0, 14)}`, exercises: s.exercises.map((e) => ({ ...e })) }));
  return insertProgram(me, { name: `${program.name} (copy)`.slice(0, MAX_NAME), description: program.description, weeks: program.weeks, goal: program.goal, level: program.level, source: program.source, gentle: program.gentle, minor: program.minor, slots });
}

/** Deleting a program ends everyone on it (workouts already given stay, they just stop being synced). */
export async function deleteProgram(me: UserRow, id: string): Promise<void> {
  const { row } = await ownRow(me, id);
  const d = await db();
  const enrolments = await d.select({ id: programEnrolments.id }).from(programEnrolments).where(eq(programEnrolments.programId, row.id));
  const ids = enrolments.map((e) => e.id);
  if (ids.length) {
    await d.update(programEnrolments).set({ status: "ENDED", endedAt: new Date() }).where(inArray(programEnrolments.id, ids));
    await d.delete(programSuggestions).where(inArray(programSuggestions.enrolmentId, ids));
  }
  await d.delete(programs).where(and(eq(programs.id, row.id), eq(programs.ownerId, me.id)));
}

export async function copyProgramWeek(me: UserRow, id: string, from: unknown, to: unknown): Promise<Program> {
  const { program, undo } = await ownRow(me, id);
  const f = Number(from);
  const targets = Array.isArray(to) ? [...new Set(to.map(Number))].filter((w) => Number.isInteger(w) && w >= 1 && w <= program.weeks && w !== f) : [];
  if (!Number.isInteger(f) || f < 1 || f > program.weeks || targets.length === 0) throw badRequest("Pick the week to copy and the weeks to copy it onto.");
  const slots = copyWeek(program.slots, f, targets);
  const out = await save(me, { ...program, slots }, { keepUndo: undo });
  await syncProgram(out.id);
  return out;
}

/* ---------------- Starter templates ---------------- */
export function listStarters() {
  return STARTERS.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb, goal: s.goal, level: s.level, weeks: s.weeks, days: s.days.length, gentle: s.gentle }));
}

export async function createFromStarter(me: UserRow, starterId: unknown): Promise<Program> {
  requireBuilder(me);
  const def = STARTERS.find((s) => s.id === starterId);
  if (!def) throw notFound("That starter program isn't there.");
  await hit(`prog-new:${me.id}`, 40, 3_600_000, "You've made a lot of programs this hour. Try again a little later.");
  const library = await libraryFor(me);
  const { slots, missing } = starterSlots(def, library);
  if (slots.length === 0) throw badRequest("The exercises this starter needs are not in your library.");
  void missing;
  return insertProgram(me, { name: def.name, description: def.blurb, weeks: def.weeks, goal: def.goal, level: def.level, source: "starter", gentle: def.gentle, minor: false, slots });
}

/* ---------------- Reading a program from text ---------------- */
export async function importFromText(me: UserRow, textRaw: unknown): Promise<ProgramImport> {
  requireBuilder(me);
  const text = typeof textRaw === "string" ? textRaw.slice(0, 60_000) : "";
  if (text.trim().length < 10) throw badRequest("Paste the program text first.");
  await hit(`prog-import:${me.id}`, 30, 3_600_000, "You've imported a lot this hour. Try again a little later.");
  const library = await libraryFor(me);
  return parseProgramText(text, buildIndex(library));
}

/* ---------------- The AI builder ---------------- */
const DAY_PATTERN: Record<number, number[]> = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 7] };

interface BuildContext {
  gentle: boolean;
  minor: boolean;
  tags: string[];
  equipment: TrainerEquipment;
  rules: CoachRule[];
  goal: string;
  level: string;
  /** What the person last lifted for each exercise, so week 1 starts from there. */
  weights: Map<string, number>;
}

const EQUIPMENT = ["BODYWEIGHT", "HOME", "GYM"] as const;
const GOALS = ["Hypertrophy", "Fat Loss", "Strength", "Conditioning", "General Fitness"] as const;
const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.find((x) => x === v) ?? d);

function lastWeights(history: Workout[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of [...history].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    for (const we of w.exercises) {
      if (out.has(we.exerciseId)) continue;
      const top = Math.max(0, ...we.sets.filter((s) => s.done && s.type !== "W").map((s) => s.weight ?? 0));
      if (top > 0) out.set(we.exerciseId, top);
    }
  }
  return out;
}

async function buildContext(me: UserRow, input: Record<string, unknown>): Promise<BuildContext> {
  const injuries = typeof input.injuries === "string" ? input.injuries.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  const level = pick(input.level, LEVELS, "Beginner");
  const goal = pick(input.goal, GOALS, "General Fitness");
  if (isSolo(me)) {
    const s = await soloSafety(me);
    if (!s) throw badRequest("Set up your AI trainer first (the health questions and your goals), then come back to build a program.");
    if (s.paused) throw badRequest("Your plan is paused because something hurt. Restart it first, once it has been looked at.");
    if (s.blocked) throw badRequest("Please confirm your doctor has cleared you to exercise first.");
    const extra = profileTags({ parq: { answers: {}, details: {}, other: injuries } as ParqData, goals: { pastInjuries: injuries, anythingElse: "", experience: level } });
    const weights = lastWeights(await recentDoneWorkouts(me.id, 120));
    return { gentle: s.gentle, minor: false, tags: [...new Set([...s.tags, ...extra])].sort(), equipment: s.equipment, rules: s.rules, goal, level, weights };
  }
  const clientId = typeof input.clientId === "string" && input.clientId ? input.clientId : null;
  const rules = await activeRules();
  const equipment = pick(input.equipment, EQUIPMENT, "GYM");
  if (!clientId) {
    const extra = profileTags({ parq: { answers: {}, details: {}, other: injuries } as ParqData, goals: { pastInjuries: injuries, anythingElse: "", experience: level } });
    return { gentle: input.gentle === true, minor: false, tags: extra, equipment, rules, goal, level, weights: new Map() };
  }
  const client = await loadClientFor(me, clientId);
  if (!client || !client.active || client.coachId !== me.id) throw notFound("Client not found.");
  const minor = isMinorRow(client);
  const intake = await intakeFor(me, clientId);
  const parq = intake.current.PARQ?.data as ParqData | undefined;
  const goals = intake.current.GOALS?.data as GoalsData | undefined;
  let medical = "";
  try {
    medical = openProfile(client).medicalNotes ?? "";
  } catch {
    medical = "";
  }
  const tags = profileTags({
    parq: { answers: parq?.answers ?? {}, details: parq?.details ?? {}, other: [parq?.other ?? "", medical, injuries].join(" ") } as ParqData,
    goals: { pastInjuries: goals?.pastInjuries ?? "", anythingElse: goals?.anythingElse ?? "", experience: level } as Pick<GoalsData, "pastInjuries" | "anythingElse" | "experience">,
  });
  const gentle = input.gentle === true || (parq ? screen(parq).gentle : false);
  const weights = lastWeights(await recentDoneWorkouts(client.id, 120));
  return { gentle, minor, tags, equipment, rules, goal, level, weights };
}

const DESIGN_SYSTEM = `You are a careful, experienced personal trainer designing WEEK 1 of a multi-week program. The rest of the weeks are filled in by the app, so design only this one week. Use ONLY exercises from the AVAILABLE list, copied exactly as written. The list has already had anything unsafe for this person removed: never go outside it.

Return ONLY one JSON object, no commentary:
{"summary":"<one friendly sentence, max 30 words, no medical claims>","days":[{"name":"<e.g. Upper body A>","focus":"<short>","exercises":[{"name":"<exact name from AVAILABLE>","sets":<1-5>,"repMin":<number>,"repMax":<number>,"durationSec":<only for timed drills>,"note":"<optional one short cue, max 12 words>"}]}]}

Make exactly the requested number of workouts and the requested number of exercises in each (big movements first, then smaller ones, core or cardio last). Choose sets and reps for the goal and level. If the person is "gentle", keep it modest (2-3 sets, 10-15 reps, easy effort). Respect the FOCUS and the NOTES by choosing exercises that suit them. Never give medical advice, never diagnose, never mention health conditions in the text. Follow the COACH RULES exactly.`;

async function aiWeekOne(input: { ctx: BuildContext; allowed: Exercise[]; sessions: number; perDay: number; focus: string; notes: string }): Promise<TrainerPlan | null> {
  const names = input.allowed.map((e) => `${e.name} [${e.primary}${e.type.startsWith("DURATION") ? ", timed" : ""}]`);
  const rules = rulesToPrompt(input.ctx.rules, input.ctx.tags);
  const content = await groq(
    {
      model: TEXT_MODEL,
      temperature: 0.4,
      reasoning_effort: "low",
      max_completion_tokens: 5000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DESIGN_SYSTEM },
        {
          role: "user",
          content: [
            `WORKOUTS IN THE WEEK: ${input.sessions}`,
            `EXERCISES IN EACH: ${input.perDay}`,
            `GOAL: ${input.ctx.goal}`,
            `LEVEL: ${input.ctx.level}`,
            `GENTLE PLAN: ${input.ctx.gentle ? "yes" : "no"}`,
            input.focus ? `FOCUS: ${input.focus}` : "",
            input.notes && !input.ctx.minor ? `NOTES: ${input.notes}` : "",
            "COACH RULES:",
            ...(rules.length ? rules : ["(none for this person)"]),
            "AVAILABLE:",
            ...names,
          ]
            .filter(Boolean)
            .join(String.fromCharCode(10)),
        },
      ],
    },
    55_000,
  );
  let parsed: unknown;
  try {
    parsed = jsonFrom(content);
  } catch {
    return null;
  }
  return sanitizePlan(parsed, input.allowed, { gentle: input.ctx.gentle, weekStart: mondayOf(), days: [], sessions: input.sessions });
}

/** Builds a program from a goal. The AI (when it is on and not busy) designs week 1; code grows it into the whole block with progression. */
export async function buildWithAi(me: UserRow, body: Record<string, unknown>): Promise<{ program: Program; usedAi: boolean; notes: string[] }> {
  requireBuilder(me);
  const weeks = weeksOf(body.weeks, 8);
  const sessions = Math.max(2, Math.min(6, Math.round(Number(body.daysPerWeek) || 3)));
  const minutes = Math.max(20, Math.min(120, Math.round(Number(body.sessionMinutes) || 45)));
  const perDay = Math.max(4, Math.min(8, Math.round(minutes / 8)));
  const focus = typeof body.focus === "string" ? body.focus.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const notes = typeof body.injuries === "string" ? body.injuries.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  const ctx = await buildContext(me, body);
  const progression = pick(body.progression, ["reps_then_weight", "linear", "effort"] as const, ctx.goal === "Strength" ? "linear" : "reps_then_weight");
  await hit(`prog-new:${me.id}`, 40, 3_600_000, "You've made a lot of programs this hour. Try again a little later.");

  const library = await libraryFor(me);
  const allowed = allowedLibrary(library, { equipment: ctx.equipment, gentle: ctx.gentle, tags: ctx.tags, rules: ctx.rules });
  if (allowed.length < 12) throw badRequest("There aren't enough suitable exercises for those answers. Try another equipment choice, or build it by hand.");

  const cap = isSolo(me) ? 2 : 5;
  let plan: TrainerPlan | null = null;
  let usedAi = false;
  const out: string[] = [];
  if (aiOn()) {
    try {
      await takeAiQuota(me.id, "program_ai", cap, "AI program builds");
      plan = await aiWeekOne({ ctx, allowed, sessions, perDay, focus, notes });
      if (plan) {
        usedAi = true;
        await logAiUsage({ userId: me.id, feature: "other" });
      } else await refundAiQuota(me.id, "program_ai");
    } catch (e) {
      await refundAiQuota(me.id, "program_ai");
      const msg = e instanceof Error ? e.message : "";
      if (/used today/i.test(msg)) throw e;
      console.error("AI program build failed", msg);
    }
  }
  if (!plan) {
    plan = buildBasicPlan({ library: allowed, goals: { goalCategory: ctx.goal, experience: ctx.level, sessionsPerWeek: sessions, days: [] } as unknown as GoalsData, gentle: ctx.gentle, volumeMod: 0, weekStart: mondayOf(), seed: `${me.id}:${Date.now()}` });
    out.push("The AI was not available, so this was built from the exercise library's own rules. You can still edit every workout.");
  }
  const ok = new Set(allowed.map((e) => e.id));
  const days = plan.days.map((d) => ({ ...d, exercises: d.exercises.filter((e) => ok.has(e.exerciseId)) })).filter((d) => d.exercises.length >= 3).slice(0, sessions);
  if (days.length === 0) throw badRequest("Couldn't build a safe program from those answers. Try different choices, or build it by hand.");

  const byId = new Map(library.map((e) => [e.id, e]));
  const pattern = DAY_PATTERN[days.length] ?? DAY_PATTERN[3];
  const weekOne: ProgramSlot[] = days.map((d, i) => ({
    id: `ps_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
    week: 1,
    day: pattern[i] ?? i + 1,
    title: d.name.slice(0, 120),
    ...(d.focus ? { note: d.focus.slice(0, 200) } : {}),
    exercises: d.exercises.map((e): TemplateExercise => {
      const ex = byId.get(e.exerciseId);
      const weighted = ex?.type === "WEIGHT_REPS" || ex?.type === "WEIGHTED_BODYWEIGHT";
      const last = ctx.weights.get(e.exerciseId);
      return {
        exerciseId: e.exerciseId,
        sets: e.sets,
        repMin: e.repMin,
        repMax: e.repMax,
        ...(e.durationSec ? { durationSec: e.durationSec } : {}),
        ...(e.note ? { notes: e.note } : {}),
        ...(weighted && last ? { weight: last } : {}),
      };
    }),
  }));
  const grown = expandWeeks(weekOne, weeks, progression);
  const checked = cleanSlots(grown, weeks, { gentle: ctx.gentle, minor: ctx.minor });
  if ("error" in checked) throw badRequest(checked.error);
  const name = str(body.name, "Name", { optional: true, max: MAX_NAME }) || `${weeks}-week ${ctx.goal.toLowerCase()} program`;
  const description = [plan.summary, ctx.gentle ? "A gentle program: lighter, no jumping or heavy bar lifts." : "", ctx.minor ? "Built for someone under 18: never fewer than 8 reps and no max-effort sets." : ""].filter(Boolean).join(" ").slice(0, 600);
  const program = await insertProgram(me, { name, description, weeks, goal: ctx.goal, level: ctx.level, source: usedAi ? "ai" : "manual", gentle: ctx.gentle, minor: ctx.minor, slots: checked.slots });
  if (ctx.gentle) out.push("Your health answers made this a gentle program: modest sets and reps, no jumping or heavy bar lifts.");
  if (ctx.weights.size) out.push("Week 1 starts from the weights last logged for these exercises.");
  return { program, usedAi, notes: out };
}

/* ---------------- Chat edits ---------------- */
const EDIT_SYSTEM = `You change an existing training program for a coach. You are given the program and one instruction. Answer with ONLY a JSON object {"ops":[...]} using these operations (use at most 6, and only what the instruction asks for):
{"op":"swap","from":"<exercise name in the program>","to":"<exact name from AVAILABLE>","weeks":[optional week numbers]}
{"op":"remove","exerciseId":"<exercise name in the program>","weeks":[optional]}
{"op":"sets","delta":<-3..3>,"weeks":[optional]}
{"op":"reps","delta":<-5..5>,"weeks":[optional]}
{"op":"weight_pct","pct":<-30..30>,"weeks":[optional]}
{"op":"deload","weeks":[week numbers]}
{"op":"add","exerciseId":"<exact name from AVAILABLE>","sets":<1-6>,"repMin":<n>,"repMax":<n>,"weeks":[optional],"day":<optional 1-7>}
"easier" means fewer sets and/or lighter weights; "harder" the opposite. If the instruction cannot be done with these operations, answer {"ops":[]}. Never output anything but the JSON.`;

export async function editWithAi(me: UserRow, id: string, instructionRaw: unknown): Promise<{ program: Program; notes: string[]; skipped: string[] }> {
  const { program, undo } = await ownRow(me, id);
  const instruction = str(instructionRaw, "Instruction", { min: 3, max: 300 });
  if (program.edits >= MAX_EDITS) throw badRequest(`You've used all ${MAX_EDITS} chat edits on this program. You can still edit it by hand, or duplicate it for 10 more.`);
  if (!aiOn()) throw badRequest("The AI is not available right now. You can edit the workouts by hand.");
  const library = await libraryFor(me);
  const ctx = isSolo(me) ? await soloSafety(me) : null;
  const allowed = allowedLibrary(library, { equipment: ctx?.equipment ?? "GYM", gentle: program.gentle, tags: ctx?.tags ?? [], rules: ctx?.rules ?? (await activeRules()) });
  const byId = new Map(library.map((e) => [e.id, e]));
  const inProgram = exerciseIdsOf(program.slots);
  const programNames = new Map(inProgram.map((x) => [norm(byId.get(x)?.name ?? x), x]));
  const allowedNames = new Map(allowed.map((e) => [norm(e.name), e.id]));
  const week1 = program.slots.filter((s) => s.week === 1);

  await takeAiQuota(me.id, "program_edit", isSolo(me) ? 10 : 30, "program edits");
  let ops: Op[] = [];
  try {
    const content = await groq(
      {
        model: TEXT_MODEL,
        temperature: 0.2,
        reasoning_effort: "low",
        max_completion_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EDIT_SYSTEM },
          {
            role: "user",
            content: [
              `PROGRAM: ${program.weeks} weeks, ${week1.length} workouts a week.`,
              ...week1.map((s) => `Day ${s.day} ${s.title}: ${s.exercises.map((e) => `${byId.get(e.exerciseId)?.name ?? e.exerciseId} ${e.sets}x${e.repMin}${e.repMax !== e.repMin ? `-${e.repMax}` : ""}`).join("; ")}`),
              `INSTRUCTION: ${instruction}`,
              "AVAILABLE (for swaps and additions):",
              ...allowed.slice(0, 400).map((e) => e.name),
            ].join(String.fromCharCode(10)),
          },
        ],
      },
      40_000,
    );
    const raw = (jsonFrom(content) as { ops?: unknown })?.ops;
    const resolved = Array.isArray(raw)
      ? raw.map((o) => {
          if (!o || typeof o !== "object") return o;
          const x = { ...(o as Record<string, unknown>) };
          const toId = (v: unknown, map: Map<string, string>) => (typeof v === "string" ? (map.get(norm(v)) ?? v) : v);
          if (x.op === "swap") {
            x.from = toId(x.from, programNames);
            x.to = toId(x.to, allowedNames);
          } else if (x.op === "remove") x.exerciseId = toId(x.exerciseId, programNames);
          else if (x.op === "add") x.exerciseId = toId(x.exerciseId, allowedNames);
          return x;
        })
      : [];
    ops = cleanOps(resolved, program.weeks, (x) => allowed.some((e) => e.id === x));
    await logAiUsage({ userId: me.id, feature: "other" });
  } catch (e) {
    await refundAiQuota(me.id, "program_edit");
    throw e instanceof Error && /allowance|used today|AI/i.test(e.message) ? e : badRequest("The AI couldn't work that out. Try wording it differently, or edit by hand.");
  }
  if (ops.length === 0) {
    await refundAiQuota(me.id, "program_edit");
    throw badRequest("I couldn't turn that into a change. Try something like “make week 3 easier”, “swap bench press for dumbbell press” or “no barbell work”.");
  }
  const nameOf = (x: string) => byId.get(x)?.name ?? x;
  const result = applyOps(program.slots, ops, { gentle: program.gentle, minor: program.minor, nameOf });
  if (result.notes.length === 0) {
    await refundAiQuota(me.id, "program_edit");
    throw badRequest(result.skipped[0] ?? "That didn't change anything in this program.");
  }
  const saved = await save(me, { ...program, slots: result.slots, edits: program.edits + 1 }, { undo: { weeks: program.weeks, slots: program.slots, label: instruction } });
  void undo;
  await syncProgram(saved.id);
  return { program: saved, notes: result.notes, skipped: result.skipped };
}

export async function undoEdit(me: UserRow, id: string): Promise<Program> {
  const { program, undo } = await ownRow(me, id);
  if (!undo) throw badRequest("There is nothing to undo.");
  const saved = await save(me, { ...program, weeks: undo.weeks, slots: undo.slots }, { undo: null });
  await syncProgram(saved.id);
  return saved;
}

/* ---------------- Giving a program to a client ---------------- */
export interface Enrolment {
  id: string;
  programId: string;
  programName: string;
  clientId: string;
  startDate: string;
  endDate: string;
  liveSync: boolean;
  status: "ACTIVE" | "ENDED";
  behind: boolean;
}

type EnrolRow = typeof programEnrolments.$inferSelect;

async function toEnrolments(rows: EnrolRow[]): Promise<Enrolment[]> {
  if (rows.length === 0) return [];
  const d = await db();
  const progRows = await d.select().from(programs).where(inArray(programs.id, [...new Set(rows.map((r) => r.programId))]));
  const byId = new Map(progRows.map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = byId.get(r.programId);
    const opened = p ? open(p) : null;
    return {
      id: r.id,
      programId: r.programId,
      programName: opened?.name ?? "A deleted program",
      clientId: r.clientId,
      startDate: r.startDate,
      endDate: programEnd(r.startDate, opened?.weeks ?? p?.weeks ?? 1),
      liveSync: r.liveSync,
      status: r.status === "ACTIVE" ? "ACTIVE" : "ENDED",
      behind: !!p && r.status === "ACTIVE" && r.appliedVersion < p.version,
    };
  });
}

export async function listEnrolments(me: UserRow, clientId?: string): Promise<Enrolment[]> {
  const d = await db();
  const own = me.role === "CLIENT" ? eq(programEnrolments.clientId, me.id) : eq(programEnrolments.ownerId, me.id);
  const rows = await d
    .select()
    .from(programEnrolments)
    .where(clientId ? and(own, eq(programEnrolments.clientId, clientId), eq(programEnrolments.status, "ACTIVE")) : and(own, eq(programEnrolments.status, "ACTIVE")))
    .orderBy(desc(programEnrolments.createdAt))
    .limit(200);
  return toEnrolments(rows);
}

async function clientAssignments(clientId: string) {
  const d = await db();
  return d.select().from(assignments).where(eq(assignments.clientId, clientId));
}

const refOf = (e: EnrolRow, p: Program, s: ProgramSlot): ProgRef => ({ enrolmentId: e.id, programId: p.id, name: p.name, week: s.week, day: s.day, slotId: s.id });
const planOf = (title: string, note: string, exercises: TemplateExercise[], ref: ProgRef): Plan => ({ title, note, exercises, prog: ref });

/** Gives a program to a client (or to yourself when you train on your own) from a start date. */
export async function assignProgram(me: UserRow, programId: string, body: Record<string, unknown>): Promise<{ enrolment: Enrolment; created: number; skipped: number; beyond: number }> {
  const { program } = await ownRow(me, programId);
  if (program.slots.length === 0) throw badRequest("Add at least one workout to the program before assigning it.");
  await hit(`prog-assign:${me.id}`, 30, 3_600_000, "You've assigned a lot of programs this hour. Try again a little later.");
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  let target: UserRow | null;
  if (isSolo(me)) target = clientId === me.id || clientId === "" ? me : null;
  else target = await loadClientFor(me, clientId);
  if (!target || (!isSolo(me) && (!target.active || target.coachId !== me.id))) throw notFound("Client not found.");
  const startDate = realDate(body.startDate, "The start day");
  if (startDate < shift(0) || startDate > shift(FUTURE_DAYS)) throw badRequest("Pick a start day from today to about six months from now.");
  const liveSync = body.liveSync !== false;

  const d = await db();
  const end = programEnd(startDate, program.weeks);
  const active = await d.select().from(programEnrolments).where(and(eq(programEnrolments.clientId, target.id), eq(programEnrolments.status, "ACTIVE")));
  for (const a of active) {
    const [pr] = await d.select().from(programs).where(eq(programs.id, a.programId)).limit(1);
    const other = pr ? open(pr) : null;
    const otherEnd = programEnd(a.startDate, other?.weeks ?? 1);
    if (a.startDate <= end && startDate <= otherEnd) throw badRequest(`They are already on “${other?.name ?? "another program"}” until ${format(parseISO(otherEnd), "d MMM")}. End it first, or start this one after it.`);
  }

  const existing = await clientAssignments(target.id);
  const perDay = new Map<string, number>();
  for (const r of existing) perDay.set(r.date, (perDay.get(r.date) ?? 0) + 1);
  const planned = program.slots.map((s) => ({ s, date: slotDate(startDate, s) }));
  const inWindow = planned.filter((x) => x.date <= shift(FUTURE_DAYS));
  const beyond = planned.length - inWindow.length;
  if (existing.length + inWindow.length > MAX_PER_CLIENT) throw badRequest("This client has a lot of assigned workouts. Delete some old ones first.");

  const enrolId = `pe_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const [row] = await d.insert(programEnrolments).values({ id: enrolId, programId: program.id, clientId: target.id, ownerId: me.id, startDate, liveSync, appliedVersion: program.version }).returning();
  let created = 0;
  let skipped = 0;
  for (const { s, date } of inWindow) {
    if ((perDay.get(date) ?? 0) >= 3) {
      skipped++;
      continue;
    }
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
    await insertPlanRow(target.id, me.id, date, planOf(s.title, s.note ?? "", s.exercises, refOf(row, program, s)));
    created++;
  }
  if (created === 0) {
    await d.delete(programEnrolments).where(eq(programEnrolments.id, enrolId));
    throw badRequest("Those days are already full of workouts.");
  }
  if (!isSolo(me)) {
    await notify([target.id], "workout_assigned", { title: "A new program from your coach", body: `${program.name} starts on ${format(parseISO(startDate), "EEE d MMM")}: ${program.weeks} week${program.weeks === 1 ? "" : "s"}.`, link: "/home", about: target.id }, { email: false });
  }
  const [enrolment] = await toEnrolments([row]);
  return { enrolment, created, skipped, beyond };
}

/** Ends a program for a client. Workouts already done or past stay; with removeFuture the coming ones go too. */
export async function endEnrolment(me: UserRow, enrolmentId: string, removeFuture: boolean): Promise<{ removed: number }> {
  if (!ID_RE.test(enrolmentId)) throw notFound("That program is gone.");
  const d = await db();
  const [row] = await d.select().from(programEnrolments).where(eq(programEnrolments.id, enrolmentId)).limit(1);
  if (!row || row.ownerId !== me.id) throw notFound("That program is gone.");
  await d.update(programEnrolments).set({ status: "ENDED", endedAt: new Date() }).where(eq(programEnrolments.id, row.id));
  await d.delete(programSuggestions).where(eq(programSuggestions.enrolmentId, row.id));
  let removed = 0;
  if (removeFuture) {
    const today = shift(0);
    const ids: string[] = [];
    for (const r of await clientAssignments(row.clientId)) {
      if (r.date <= today) continue;
      if (openPlan(r)?.prog?.enrolmentId === row.id) ids.push(r.id);
    }
    if (ids.length) {
      await d.delete(assignments).where(inArray(assignments.id, ids));
      removed = ids.length;
    }
  }
  return { removed };
}

/** When a client is deleted, their programs end and their suggestions go. */
export async function purgeClientPrograms(clientId: string): Promise<void> {
  const d = await db();
  await d.delete(programSuggestions).where(eq(programSuggestions.clientId, clientId));
  await d.delete(programEnrolments).where(eq(programEnrolments.clientId, clientId));
}

/* ---------------- Live Sync ---------------- */
/**
 * Brings everyone on a program (with Live Sync on) up to date with it. Only days after today are touched; a day the coach changed by hand
 * ("locked") and every day up to today are left exactly as they are. Returns how many clients were updated.
 */
export async function syncProgram(programId: string): Promise<number> {
  const d = await db();
  const [prow] = await d.select().from(programs).where(eq(programs.id, programId)).limit(1);
  const program = prow ? open(prow) : null;
  if (!prow || !program) return 0;
  const enrolments = await d.select().from(programEnrolments).where(and(eq(programEnrolments.programId, programId), eq(programEnrolments.status, "ACTIVE"), eq(programEnrolments.liveSync, true)));
  let updated = 0;
  for (const e of enrolments) {
    try {
      await syncOne(e, program, prow.version);
      updated++;
    } catch (err) {
      console.error("Live sync failed for", e.id, err instanceof Error ? err.message : err);
    }
  }
  return updated;
}

async function syncOne(e: EnrolRow, program: Program, version: number): Promise<void> {
  const d = await db();
  const today = shift(0);
  const rows = await clientAssignments(e.clientId);
  const perDay = new Map<string, number>();
  for (const r of rows) perDay.set(r.date, (perDay.get(r.date) ?? 0) + 1);
  const slotById = new Map(program.slots.map((s) => [s.id, s]));
  const have = new Set<string>();
  const drop: string[] = [];
  for (const r of rows) {
    const plan = openPlan(r);
    if (!plan?.prog || plan.prog.enrolmentId !== e.id) continue;
    have.add(plan.prog.slotId);
    if (r.date <= today || plan.prog.locked) continue;
    const slot = slotById.get(plan.prog.slotId);
    if (!slot) {
      drop.push(r.id);
      continue;
    }
    let date = slotDate(e.startDate, slot);
    if (date <= today || date > shift(FUTURE_DAYS)) date = r.date;
    if (date !== r.date) {
      if ((perDay.get(date) ?? 0) >= 3) date = r.date;
      else {
        perDay.set(r.date, (perDay.get(r.date) ?? 1) - 1);
        perDay.set(date, (perDay.get(date) ?? 0) + 1);
      }
    }
    await rewritePlanRow(r, planOf(slot.title, slot.note ?? "", slot.exercises, { ...plan.prog, name: program.name, week: slot.week, day: slot.day }), date);
  }
  if (drop.length) await d.delete(assignments).where(inArray(assignments.id, drop));
  let total = rows.length - drop.length;
  for (const s of program.slots) {
    if (have.has(s.id)) continue;
    const date = slotDate(e.startDate, s);
    if (date <= today || date > shift(FUTURE_DAYS) || (perDay.get(date) ?? 0) >= 3 || total >= MAX_PER_CLIENT) continue;
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
    total++;
    await insertPlanRow(e.clientId, e.ownerId, date, planOf(s.title, s.note ?? "", s.exercises, refOf(e, program, s)));
  }
  await d.update(programEnrolments).set({ appliedVersion: version }).where(eq(programEnrolments.id, e.id));
}

/* ---------------- Monday suggestions ---------------- */
export interface SuggestionItem {
  exerciseId: string;
  kind: "progress" | "hold" | "easier";
  /** The weight (kg) to set for next week, for progress and hold. */
  weight?: number;
  text: string;
}
interface SuggestionData {
  summary: string;
  items: SuggestionItem[];
  missed: number;
}
const aadS = (id: string) => `program-suggestion:${id}`;

export interface SuggestionView {
  id: string;
  clientId: string;
  clientName: string;
  programName: string;
  weekStart: string;
  summary: string;
  items: SuggestionItem[];
  createdAt: string;
}

const addDays = (day: string, n: number) => dayKey(new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n)));

/** The suggestions for one coach's clients this week: plain rules over what the client actually logged, never applied without a tap. */
export async function generateSuggestions(ownerId: string, now = new Date()): Promise<number> {
  const d = await db();
  const weekStart = mondayOf(now);
  const lastStart = addDays(weekStart, -7);
  const lastEnd = addDays(weekStart, -1);
  const nextEnd = addDays(weekStart, 6);
  const enrolments = await d.select().from(programEnrolments).where(and(eq(programEnrolments.ownerId, ownerId), eq(programEnrolments.status, "ACTIVE")));
  let made = 0;
  for (const e of enrolments) {
    if (e.clientId === ownerId) continue; // people training on their own are not coached
    const [exists] = await d.select({ id: programSuggestions.id }).from(programSuggestions).where(and(eq(programSuggestions.enrolmentId, e.id), eq(programSuggestions.weekStart, weekStart))).limit(1);
    if (exists) continue;
    const rows = await clientAssignments(e.clientId);
    const mine = rows.map((r) => ({ r, plan: openPlan(r) })).filter((x): x is { r: (typeof rows)[number]; plan: Plan } => !!x.plan?.prog && x.plan.prog.enrolmentId === e.id);
    const last = mine.filter((x) => x.r.date >= lastStart && x.r.date <= lastEnd);
    const next = mine.filter((x) => x.r.date >= weekStart && x.r.date <= nextEnd);
    if (last.length === 0 || next.length === 0) continue;
    const workouts = await recentDoneWorkouts(e.clientId, 60);
    const doneBy = new Map(workouts.filter((w) => w.assignmentId).map((w) => [w.assignmentId as string, w]));
    let missed = 0;
    const pains: number[] = [];
    const items: SuggestionItem[] = [];
    const plannedNext = new Map<string, number | undefined>();
    for (const n of next) for (const ex of n.plan.exercises) if (!plannedNext.has(ex.exerciseId)) plannedNext.set(ex.exerciseId, ex.weight);
    for (const a of last) {
      const w = doneBy.get(a.r.id);
      if (!w) {
        if (!a.plan.doneManually) missed++;
        continue;
      }
      if (typeof w.feedback?.pain === "number") pains.push(w.feedback.pain);
      for (const target of a.plan.exercises) {
        if (items.some((i) => i.exerciseId === target.exerciseId)) continue;
        const we = w.exercises.find((x) => x.exerciseId === target.exerciseId);
        const ws = (we?.sets ?? []).filter((s) => s.done && s.type !== "W");
        if (!we || ws.length === 0 || target.durationSec) continue;
        const top = Math.max(0, ...ws.map((s) => s.weight ?? 0));
        if (top <= 0) continue;
        const reached = ws.filter((s) => (s.reps ?? 0) >= target.repMin).length;
        const allDone = ws.length >= target.sets && reached === ws.length;
        const hard = ws.some((s) => (s.rpe ?? 0) >= 9.5);
        const planned = plannedNext.get(target.exerciseId);
        if (allDone && !hard) {
          const to = Math.round((top + 2.5) * 2) / 2;
          if (planned === undefined || planned < to) items.push({ exerciseId: target.exerciseId, kind: "progress", weight: to, text: `Hit every set at ${top} kg: go to ${to} kg` });
        } else if (reached < ws.length * 0.66 || ws.length < target.sets * 0.67) {
          if (planned === undefined || planned > top) items.push({ exerciseId: target.exerciseId, kind: "hold", weight: top, text: `Missed reps at ${top} kg: stay at ${top} kg` });
        }
      }
    }
    const pain = pains.length ? pains.reduce((x, y) => x + y, 0) / pains.length : null;
    const easier = missed >= 2 || (pain !== null && pain >= 6);
    const final = easier ? [{ exerciseId: "*", kind: "easier" as const, text: missed >= 2 ? `Missed ${missed} workouts last week: make next week a bit easier` : "Workouts felt painful last week: make next week a bit easier" }, ...items.filter((i) => i.kind !== "progress")] : items;
    if (final.length === 0) continue;
    const data: SuggestionData = { summary: easier ? "Last week was tough." : "Last week went well.", items: final.slice(0, 6), missed };
    const id = `sg_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    try {
      await d.insert(programSuggestions).values({ id, enrolmentId: e.id, clientId: e.clientId, ownerId, weekStart, dataEnc: encryptJson(data, aadS(id)) });
      made++;
    } catch {
      /* another run made it first */
    }
  }
  return made;
}

/** The Monday job for everyone with a coached program running. */
export async function weeklySuggestionsForAll(now = new Date()): Promise<{ coaches: number; suggestions: number }> {
  const d = await db();
  const rows = await d.selectDistinct({ ownerId: programEnrolments.ownerId }).from(programEnrolments).where(eq(programEnrolments.status, "ACTIVE"));
  let suggestions = 0;
  for (const r of rows) {
    try {
      suggestions += await generateSuggestions(r.ownerId, now);
    } catch (e) {
      console.error("suggestions failed for", r.ownerId, e instanceof Error ? e.message : e);
    }
  }
  return { coaches: rows.length, suggestions };
}

export async function listSuggestions(me: UserRow): Promise<SuggestionView[]> {
  if (!isStaff(me)) return [];
  const d = await db();
  const rows = await d.select().from(programSuggestions).where(and(eq(programSuggestions.ownerId, me.id), eq(programSuggestions.status, "PENDING"))).orderBy(desc(programSuggestions.createdAt)).limit(60);
  if (rows.length === 0) return [];
  const clientRows = await d.select().from(users).where(and(inArray(users.id, [...new Set(rows.map((r) => r.clientId))]), eq(users.coachId, me.id), eq(users.active, true)));
  const names = new Map<string, string>();
  for (const c of clientRows) {
    try {
      names.set(c.id, openProfile(c).name);
    } catch {
      names.set(c.id, c.username);
    }
  }
  const enrolRows = await d.select().from(programEnrolments).where(inArray(programEnrolments.id, [...new Set(rows.map((r) => r.enrolmentId))]));
  const enrols = await toEnrolments(enrolRows);
  const byEnrol = new Map(enrols.map((e) => [e.id, e]));
  const out: SuggestionView[] = [];
  for (const r of rows) {
    if (!names.has(r.clientId)) continue;
    try {
      const data = decryptJson<SuggestionData>(r.dataEnc, aadS(r.id));
      out.push({ id: r.id, clientId: r.clientId, clientName: names.get(r.clientId) ?? "", programName: byEnrol.get(r.enrolmentId)?.programName ?? "", weekStart: r.weekStart, summary: data.summary, items: data.items, createdAt: r.createdAt.toISOString() });
    } catch (e) {
      console.error("Could not decrypt suggestion", r.id, e);
    }
  }
  return out;
}

/** Apply (changes next week's workouts for this client only, and locks those days) or dismiss a suggestion. */
export async function decideSuggestion(me: UserRow, id: string, action: unknown): Promise<{ changed: number }> {
  if (!isStaff(me)) throw forbidden();
  if (!ID_RE.test(id)) throw notFound("That suggestion is gone.");
  if (action !== "apply" && action !== "dismiss") throw badRequest("Choose apply or dismiss.");
  const d = await db();
  const [row] = await d.select().from(programSuggestions).where(eq(programSuggestions.id, id)).limit(1);
  if (!row || row.ownerId !== me.id || row.status !== "PENDING") throw notFound("That suggestion is gone.");
  let changed = 0;
  if (action === "apply") {
    const data = decryptJson<SuggestionData>(row.dataEnc, aadS(row.id));
    const end = addDays(row.weekStart, 6);
    const today = shift(0);
    for (const r of await clientAssignments(row.clientId)) {
      const plan = openPlan(r);
      if (!plan?.prog || plan.prog.enrolmentId !== row.enrolmentId || r.date < row.weekStart || r.date > end || r.date < today) continue;
      let touched = false;
      const exercises = plan.exercises.map((ex): TemplateExercise => {
        let next = ex;
        for (const item of data.items) {
          if (item.kind === "easier") {
            next = { ...next, sets: Math.max(2, next.sets - 1), ...(typeof next.weight === "number" ? { weight: Math.round(next.weight * 0.9 * 2) / 2 } : {}) };
            touched = true;
          } else if (item.exerciseId === ex.exerciseId && typeof item.weight === "number") {
            next = { ...next, weight: item.weight };
            touched = true;
          }
        }
        return next;
      });
      if (touched) {
        await rewritePlanRow(r, { ...plan, exercises, prog: { ...plan.prog, locked: true } });
        changed++;
      }
    }
    if (changed) await notify([row.clientId], "workout_assigned", { title: "Your coach updated this week", body: "Your coach adjusted this week's workouts based on how last week went.", link: "/home", about: row.clientId }, { email: false });
  }
  await d.update(programSuggestions).set({ status: action === "apply" ? "APPLIED" : "DISMISSED", decidedAt: new Date() }).where(eq(programSuggestions.id, row.id));
  return { changed };
}
