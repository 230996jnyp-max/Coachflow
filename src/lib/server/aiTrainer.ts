import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { SEED_EXERCISES } from "@/data/exercises";
import {
  allowedLibrary,
  buildBasicPlan,
  emptyState,
  nextVolumeMod,
  NOT_MEDICAL_ADVICE,
  PAUSE_ADVICE,
  profileTags,
  sanitizePlan,
  screen,
  sessionsPerWeek,
  TRAINER_EQUIPMENT,
  URGENT_WORDS,
  weekStartOf,
  type CoachRule,
  type TrainerEquipment,
  type TrainerPlan,
  type TrainerProfile,
  type TrainerState,
} from "@/lib/aiTrainer";
import { rulesToPrompt } from "@/lib/aiReview";
import { cleanForm } from "@/lib/intakeForms";
import type { RoutineTemplate } from "@/lib/types";
import { isMinorRow } from "./accounts";
import { aiConfigured, groq, jsonFrom, TEXT_MODEL } from "./ai";
import { logAiUsage } from "./aiLog";
import { refundAiQuota, takeAiQuota } from "./aiQuota";
import { decryptJson, encryptJson } from "./crypto";
import { db, isLocalTestMode } from "./db";
import { badRequest, forbidden } from "./http";
import { aiRules, aiTrainerPlans, aiTrainerProfiles, type UserRow } from "./schema";
import { recentDoneWorkouts } from "./training";

/*
 * The AI trainer for people with no coach. Everything about the person (health answers, goals, plans) is encrypted and only they can
 * read it. The AI never decides what is safe: every plan it writes is checked against the rules in lib/aiTrainer.ts (health screening,
 * conditions, and the reviewing coaches' rules) and anything the rules forbid is dropped. If the AI is busy or switched off, a plan
 * built from the same rules takes its place.
 */

const aadProfile = (userId: string) => `ai-trainer:${userId}`;
const aadPlan = (id: string) => `ai-plan:${id}`;
const AI_PLANS_PER_DAY = 4;

/** Whether the AI writes plans. (On a local test server a helper can switch it off, so tests never spend the free AI allowance.) */
const aiOn = (): boolean => aiConfigured() && !(isLocalTestMode() && process.env.AI_TRAINER_DISABLE === "1");

/** Someone training on their own: a client account with no coach. */
export const isSoloUser = (me: Pick<UserRow, "role" | "coachId">): boolean => me.role === "CLIENT" && !me.coachId;

export function requireSolo(me: UserRow): void {
  if (!isSoloUser(me)) throw forbidden("The AI trainer is for people training on their own.");
  // Under-18s have no AI features (their health answers are not something we hand to an AI).
  if (isMinorRow(me)) throw forbidden("The AI trainer isn't available under 18. Ask a parent or guardian to help you find a coach.");
}

interface Stored {
  profile: TrainerProfile;
  state: TrainerState;
}

async function loadStored(userId: string): Promise<Stored | null> {
  const d = await db();
  const [row] = await d.select().from(aiTrainerProfiles).where(eq(aiTrainerProfiles.userId, userId)).limit(1);
  if (!row) return null;
  try {
    const s = decryptJson<Stored>(row.dataEnc, aadProfile(userId));
    return { profile: s.profile, state: { ...emptyState(), ...s.state } };
  } catch {
    return null;
  }
}

async function saveStored(userId: string, s: Stored): Promise<void> {
  const d = await db();
  const dataEnc = encryptJson(s, aadProfile(userId));
  await d.insert(aiTrainerProfiles).values({ userId, dataEnc }).onConflictDoUpdate({ target: aiTrainerProfiles.userId, set: { dataEnc, updatedAt: new Date() } });
}

export interface StoredPlan extends TrainerPlan {
  id: string;
  createdAt: string;
  /** The workouts of the plan, ready to be saved into the person's routines. */
  templates: RoutineTemplate[];
}

async function loadPlan(userId: string): Promise<StoredPlan | null> {
  const d = await db();
  const [row] = await d.select().from(aiTrainerPlans).where(eq(aiTrainerPlans.userId, userId)).orderBy(desc(aiTrainerPlans.weekStart), desc(aiTrainerPlans.createdAt)).limit(1);
  if (!row) return null;
  try {
    return { ...decryptJson<Omit<StoredPlan, "id" | "createdAt">>(row.dataEnc, aadPlan(row.id)), id: row.id, createdAt: row.createdAt.toISOString() };
  } catch {
    return null;
  }
}

/** The coaches' rules (only the active ones from approved reviews). */
export async function activeRules(): Promise<(CoachRule & { id: string })[]> {
  const d = await db();
  const rows = await d.select().from(aiRules).where(eq(aiRules.active, true)).orderBy(desc(aiRules.createdAt)).limit(300);
  return rows.map((r) => {
    const list = (s: string): string[] => {
      try {
        const v = JSON.parse(s);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      } catch {
        return [];
      }
    };
    return { id: r.id, tags: list(r.tags), exerciseIds: list(r.exerciseIds), text: r.text };
  });
}

export interface TrainerView {
  /** They have done the health questions and goals. */
  ready: boolean;
  notice: string;
  paused: boolean;
  pauseNote: string;
  pauseAdvice: string;
  gentle: boolean;
  needsClearance: boolean;
  equipment: TrainerEquipment | null;
  goal: string;
  sessions: number;
  plan: StoredPlan | null;
  /** The plan on screen is for an earlier week: build this week's. */
  planIsOld: boolean;
  thisWeek: string;
  aiAvailable: boolean;
}

export async function trainerView(me: UserRow): Promise<TrainerView> {
  requireSolo(me);
  const s = await loadStored(me.id);
  const plan = await loadPlan(me.id);
  const thisWeek = weekStartOf();
  const sc = s ? screen(s.profile.parq) : null;
  return {
    ready: !!s,
    notice: NOT_MEDICAL_ADVICE,
    paused: !!s?.state.pausedAt,
    pauseNote: s?.state.pauseNote ?? "",
    pauseAdvice: PAUSE_ADVICE,
    gentle: sc?.gentle ?? false,
    needsClearance: sc?.needsClearance ?? false,
    equipment: s?.profile.equipment ?? null,
    goal: s?.profile.goals.mainGoal ?? "",
    sessions: s ? sessionsPerWeek(s.profile.goals) : 3,
    plan,
    planIsOld: !!plan && plan.weekStart < thisWeek,
    thisWeek,
    aiAvailable: aiOn(),
  };
}

/** What they filled in is checked again here. Any "yes" on the health questions needs the clearance box before a plan is built. */
export async function saveProfile(me: UserRow, body: Record<string, unknown>): Promise<TrainerView> {
  requireSolo(me);
  const parq = cleanForm("PARQ", body.parq);
  if (!parq.ok) throw badRequest(parq.error);
  const goals = cleanForm("GOALS", body.goals);
  if (!goals.ok) throw badRequest(goals.error);
  const equipment = TRAINER_EQUIPMENT.find((e) => e === body.equipment);
  if (!equipment) throw badRequest("Choose the equipment you have.");
  if (body.accepted !== true) throw badRequest("Please confirm that you understand this is not medical advice.");
  const sc = screen(parq.data);
  if (sc.needsClearance && body.clearance !== true) throw badRequest("Because of your health answers, please check with your doctor first, then confirm they said you can exercise.");
  const before = await loadStored(me.id);
  await saveStored(me.id, {
    profile: { parq: parq.data, goals: goals.data, equipment, clearance: body.clearance === true, acceptedAt: new Date().toISOString() },
    // Changing the answers starts the adjustments over; a pause stays until they say it has been looked at.
    state: before ? { ...before.state, volumeMod: 0 } : emptyState(),
  });
  return trainerView(me);
}

/** "Something hurts": the plan is paused until they say it has been looked at. */
export async function reportHurts(me: UserRow, noteRaw: unknown): Promise<TrainerView & { urgent: boolean }> {
  requireSolo(me);
  const s = await loadStored(me.id);
  if (!s) throw badRequest("Set up your trainer first.");
  const note = typeof noteRaw === "string" ? noteRaw.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  await saveStored(me.id, { ...s, state: { ...s.state, pausedAt: new Date().toISOString(), pauseNote: note } });
  return { ...(await trainerView(me)), urgent: URGENT_WORDS.test(note) };
}

export async function resumeTraining(me: UserRow, confirmed: unknown): Promise<TrainerView> {
  requireSolo(me);
  if (confirmed !== true) throw badRequest("Please confirm it has been looked at, or that it has settled.");
  const s = await loadStored(me.id);
  if (!s) throw badRequest("Set up your trainer first.");
  await saveStored(me.id, { ...s, state: { ...s.state, pausedAt: null, pauseNote: "", volumeMod: Math.min(0, s.state.volumeMod) } });
  return trainerView(me);
}

/** How last week went, from the workouts they finished from the plan and how those felt. */
async function lastWeekFacts(me: UserRow, plan: StoredPlan | null): Promise<{ completion: number | null; pain: number | null; text: string }> {
  if (!plan || plan.days.length === 0) return { completion: null, pain: null, text: "" };
  const ids = new Set(plan.templates.map((t) => t.id));
  const done = (await recentDoneWorkouts(me.id, 60)).filter((w) => w.templateId && ids.has(w.templateId) && new Date(w.startedAt).getTime() > Date.now() - 16 * 86_400_000);
  const completion = Math.min(1, done.length / plan.days.length);
  const pains = done.map((w) => w.feedback?.pain).filter((p): p is number => typeof p === "number");
  const pain = pains.length ? pains.reduce((a, b) => a + b, 0) / pains.length : null;
  const areas = [...new Set(done.flatMap((w) => w.feedback?.areas ?? []))].slice(0, 4);
  const text = `Last week they planned ${plan.days.length} workouts and finished ${done.length}.${pain !== null ? ` Average soreness or pain after workouts: ${pain.toFixed(1)} out of 10.` : ""}${areas.length ? ` Areas that hurt: ${areas.join(", ")}.` : ""}`;
  return { completion, pain, text };
}

const SYSTEM = `You are a careful, friendly personal trainer writing ONE WEEK of workouts for a person who trains on their own, with no coach. Use ONLY exercises from the AVAILABLE list, copied exactly as written. The list has already had anything unsafe for this person removed: never go outside it.

Return ONLY one JSON object, no commentary:
{"summary":"<one friendly sentence, max 30 words, no medical claims>","days":[{"name":"<e.g. Day 1: Upper body>","focus":"<short>","exercises":[{"name":"<exact name from AVAILABLE>","sets":<1-5>,"repMin":<number>,"repMax":<number>,"durationSec":<only for timed drills>,"note":"<optional one short cue, max 12 words>"}]}]}

Make exactly the requested number of workouts, 5 to 7 exercises each, in a sensible order (big movements first, then smaller ones, core or cardio last). Keep sets and reps appropriate for the goal and experience. If the person is "gentle", keep it modest (2-3 sets, 10-15 reps, easy effort). Never give medical advice, never diagnose, never mention health conditions in the text. Follow the COACH RULES exactly. If last week went badly (low completion or high pain), make this week easier; if it went well, add a little.`;

async function aiPlan(input: { profile: TrainerProfile; gentle: boolean; tags: string[]; allowed: ReturnType<typeof allowedLibrary>; rules: CoachRule[]; facts: string; weekStart: string; volumeMod: number }): Promise<TrainerPlan | null> {
  const sessions = sessionsPerWeek(input.profile.goals);
  const g = input.profile.goals;
  // The model sees a short list (not the whole library) so the answer stays small and every name is one it may use.
  const names = input.allowed.map((e) => `${e.name} [${e.primary}${e.type.startsWith("DURATION") ? ", timed" : ""}]`);
  const content = await groq(
    {
      model: TEXT_MODEL,
      temperature: 0.4,
      reasoning_effort: "low",
      max_completion_tokens: 6000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            `WORKOUTS THIS WEEK: ${sessions}`,
            `GOAL: ${g.goalCategory || "General Fitness"}${g.mainGoal ? ` (${g.mainGoal})` : ""}`,
            `EXPERIENCE: ${g.experience || "Beginner"}`,
            `GENTLE PLAN: ${input.gentle ? "yes" : "no"}`,
            `PREFERRED DAYS: ${g.days.join(", ") || "any"}`,
            `ADJUSTMENT FROM LAST WEEK (-1 easier, 0 same, 1 a little more): ${input.volumeMod}`,
            input.facts ? `LAST WEEK: ${input.facts}` : "",
            "COACH RULES:",
            ...(rulesToPrompt(input.rules, input.tags).length ? rulesToPrompt(input.rules, input.tags) : ["(none for this person)"]),
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
  return sanitizePlan(parsed, input.allowed, { gentle: input.gentle, weekStart: input.weekStart, days: g.days, sessions });
}

export function templatesFor(userId: string, plan: TrainerPlan): RoutineTemplate[] {
  return plan.days.map((day) => ({
    id: `t_${randomUUID().slice(0, 12)}`,
    ownerId: userId,
    name: `AI Trainer · ${day.name}`.slice(0, 60),
    shared: false,
    exercises: day.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets, repMin: e.repMin, repMax: e.repMax, ...(e.durationSec ? { durationSec: e.durationSec } : {}), ...(e.note ? { notes: e.note } : {}) })),
  }));
}

/**
 * Builds this week's plan. Last week's training nudges it (a little more if it went well, a little less if it hurt or was skipped).
 * Always safe: the AI's answer is checked against the rules and a rule-built plan stands in if the AI is busy.
 */
export async function buildPlan(me: UserRow, opts: { rebuild?: boolean } = {}): Promise<TrainerView> {
  requireSolo(me);
  const s = await loadStored(me.id);
  if (!s) throw badRequest("Set up your trainer first.");
  if (s.state.pausedAt) throw badRequest("Your plan is paused because something hurt. Restart it first, once it has been looked at.");
  const sc = screen(s.profile.parq);
  if (sc.needsClearance && !s.profile.clearance) throw badRequest("Please confirm your doctor has cleared you to exercise first.");

  const weekStart = weekStartOf();
  const existing = await loadPlan(me.id);
  if (existing && existing.weekStart === weekStart && !opts.rebuild) return trainerView(me);

  // A new week looks back at the last plan (what they finished, how it felt). Rebuilding the same week keeps its adjustment.
  const prior = existing && existing.weekStart < weekStart ? existing : null;
  const facts = await lastWeekFacts(me, prior);
  const volumeMod = prior ? nextVolumeMod(s.state.volumeMod, facts.completion, facts.pain) : s.state.volumeMod;
  const tags = profileTags({ parq: s.profile.parq, goals: s.profile.goals });
  const rules = await activeRules();
  const allowed = allowedLibrary(SEED_EXERCISES, { equipment: s.profile.equipment, gentle: sc.gentle, tags, rules });
  if (allowed.length < 12) throw badRequest("There aren't enough suitable exercises for your answers. Please see a coach or a doctor for a plan made for you.");

  let plan: TrainerPlan | null = null;
  if (aiOn()) {
    try {
      await takeAiQuota(me.id, "ai_trainer", AI_PLANS_PER_DAY, "AI plans");
      plan = await aiPlan({ profile: s.profile, gentle: sc.gentle, tags, allowed, rules, facts: facts.text, weekStart, volumeMod });
      if (plan) await logAiUsage({ userId: me.id, feature: "ai_trainer" });
      else await refundAiQuota(me.id, "ai_trainer");
    } catch (e) {
      await refundAiQuota(me.id, "ai_trainer");
      if (!(e instanceof Error) || !/allowance|used today/i.test(e.message)) console.error("AI trainer plan failed", e instanceof Error ? e.message : e);
      else if (opts.rebuild) throw e;
    }
  }
  if (!plan) {
    plan = buildBasicPlan({ library: allowed, goals: s.profile.goals, gentle: sc.gentle, volumeMod, weekStart, seed: `${me.id}:${s.state.weeksBuilt}` });
  }
  if (plan.days.length === 0) throw badRequest("Couldn't build a plan from your answers. Please see a coach for a plan made for you.");

  // Last line of defence: nothing the rules forbid is ever saved, whoever wrote it.
  const ok = new Set(allowed.map((e) => e.id));
  plan.days = plan.days.map((d) => ({ ...d, exercises: d.exercises.filter((e) => ok.has(e.exerciseId)) })).filter((d) => d.exercises.length >= 3);
  if (plan.days.length === 0) throw badRequest("Couldn't build a safe plan from your answers. Please see a coach for a plan made for you.");

  const id = `ap_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const stored: Omit<StoredPlan, "id" | "createdAt"> = { ...plan, templates: templatesFor(me.id, plan) };
  const d = await db();
  if (existing && existing.weekStart === weekStart) await d.delete(aiTrainerPlans).where(and(eq(aiTrainerPlans.userId, me.id), eq(aiTrainerPlans.weekStart, weekStart)));
  await d.insert(aiTrainerPlans).values({ id, userId: me.id, weekStart, dataEnc: encryptJson(stored, aadPlan(id)) });
  await saveStored(me.id, { ...s, state: { ...s.state, volumeMod, weeksBuilt: s.state.weeksBuilt + 1 } });
  return trainerView(me);
}

/**
 * For the program builder: what this person's health answers, goals and equipment mean for the exercises they may be given (the same rules
 * the weekly plan uses). Null until they have set the trainer up. A person who needs a doctor's clearance, or whose plan is paused, gets no program.
 */
export async function soloSafety(me: UserRow): Promise<{ gentle: boolean; tags: string[]; equipment: TrainerEquipment; goal: string; experience: string; sessions: number; rules: (CoachRule & { id: string })[]; paused: boolean; blocked: boolean } | null> {
  requireSolo(me);
  const s = await loadStored(me.id);
  if (!s) return null;
  const sc = screen(s.profile.parq);
  return {
    gentle: sc.gentle,
    tags: profileTags({ parq: s.profile.parq, goals: s.profile.goals }),
    equipment: s.profile.equipment,
    goal: s.profile.goals.goalCategory || "General Fitness",
    experience: s.profile.goals.experience || "Beginner",
    sessions: sessionsPerWeek(s.profile.goals),
    rules: await activeRules(),
    paused: !!s.state.pausedAt,
    blocked: sc.needsClearance && !s.profile.clearance,
  };
}
