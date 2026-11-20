/*
 * The coaches' monthly AI review. Each month a coach is shown five made-up client profiles, each with a plan the AI trainer drafted,
 * and says whether it is safe, takes out what they would not give, and writes what the AI should do differently. Approved reviews become
 * rules that the AI trainer's plans are checked against (see aiTrainer.ts). The coach earns 10% off their next invoice.
 *
 * One of the five drafts has a mistake planted in it on purpose (an attention check): a coach who calls it safe has not really looked.
 * Pure: no database. The server stores reviews, applies the discount and lets the owner spot-check the flagged ones.
 */
import { PARQ_QUESTIONS, type GoalsData, type ParqData, type ParqId } from "@/lib/intakeForms";
import { allowedLibrary, buildBasicPlan, hashSeed, profileTags, screen, type CoachRule, type TrainerEquipment, type TrainerPlan } from "@/lib/aiTrainer";
import type { Exercise } from "@/lib/types";

export const DISCOUNT_PERCENT = 10;
export const CASES_PER_REVIEW = 5;
/** Five profiles read properly take longer than this; faster than this is not a real review. */
export const MIN_SECONDS = 120;

export const VERDICTS = ["SAFE", "CHANGES", "UNSAFE"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_LABEL: Record<Verdict, string> = {
  SAFE: "Safe as it is",
  CHANGES: "Needs changes",
  UNSAFE: "Not safe for this person",
};

interface Archetype {
  id: string;
  title: string;
  /** What the coach reads about this person. */
  lines: string[];
  yes: ParqId[];
  details?: Partial<Record<ParqId, string>>;
  goals: Partial<GoalsData>;
  equipment: TrainerEquipment;
  /** A drill that should NOT be in this person's plan (planted into one case a month). */
  hazard: RegExp;
}

const ARCHETYPES: Archetype[] = [
  { id: "desk-back", title: "Desk worker with a sore lower back", lines: ["Age about 38, sits all day", "Wants to lose weight and feel better", "Lower back pain after sitting", "Beginner, trains at home, 3 days a week"], yes: ["joints"], details: { joints: "Lower back pain from sitting all day." }, goals: { goalCategory: "Fat Loss", experience: "Beginner", sessionsPerWeek: 3, workType: "Desk or sitting" }, equipment: "HOME", hazard: /^Sit Up$/i },
  { id: "knee-pain", title: "Knee pain, wants to lose weight", lines: ["Age about 45", "Right knee hurts on stairs and squats", "Wants to lose weight", "Beginner, trains at home, 3 days a week"], yes: ["joints"], details: { joints: "Right knee pain on stairs." }, goals: { goalCategory: "Fat Loss", experience: "Beginner", sessionsPerWeek: 3, pastInjuries: "Knee pain, no surgery" }, equipment: "HOME", hazard: /^Jump Squat$/i },
  { id: "pregnant", title: "Pregnant, second trimester", lines: ["Age about 31, 20 weeks pregnant, doctor has cleared exercise", "Wants to stay active and strong", "Has trained before", "Trains at home, 3 days a week"], yes: ["pregnant"], goals: { goalCategory: "General Fitness", experience: "Intermediate", sessionsPerWeek: 3 }, equipment: "HOME", hazard: /^Crunch$/i },
  { id: "blood-pressure", title: "On blood pressure medication", lines: ["Age about 55", "Takes medication for high blood pressure; doctor says exercise is fine", "Wants general fitness", "Beginner, full gym, 3 days a week"], yes: ["meds"], details: { meds: "High blood pressure tablets." }, goals: { goalCategory: "General Fitness", experience: "Beginner", sessionsPerWeek: 3 }, equipment: "GYM", hazard: /squat.*\(barbell\)|\(barbell\).*squat|deadlift.*\(barbell\)/i },
  { id: "shoulder", title: "Shoulder injury last year", lines: ["Age about 29", "Injured a shoulder 10 months ago, cleared by a physio", "Wants to build muscle", "Intermediate, full gym, 4 days a week"], yes: ["recent"], details: { recent: "Shoulder injury, physio discharged me." }, goals: { goalCategory: "Hypertrophy", experience: "Intermediate", sessionsPerWeek: 4, pastInjuries: "Shoulder injury last year" }, equipment: "GYM", hazard: /handstand push up|military|overhead press/i },
  { id: "new-strong", title: "Healthy beginner who wants to get stronger", lines: ["Age about 26, no health problems", "Wants to get stronger", "Complete beginner, full gym, 3 days a week"], yes: [], goals: { goalCategory: "Strength", experience: "Beginner", sessionsPerWeek: 3 }, equipment: "GYM", hazard: /muscle up|snatch|clean and press \(barbell\)/i },
  { id: "senior", title: "65 and new to exercise", lines: ["Age about 65, first time exercising", "Some stiff joints, doctor happy for them to start", "Wants to stay independent", "Beginner, trains at home, 2 days a week"], yes: ["joints"], details: { joints: "Stiff hips and knees." }, goals: { goalCategory: "General Fitness", experience: "Beginner", sessionsPerWeek: 2, pastInjuries: "Stiff hips and knees" }, equipment: "HOME", hazard: /box jump|burpee/i },
  { id: "runner-ankle", title: "Runner with a past ankle sprain", lines: ["Age about 34, training for a half marathon", "Rolled an ankle twice, no current pain", "Wants strength work for running", "Intermediate, full gym, 3 days a week"], yes: [], goals: { goalCategory: "Conditioning", experience: "Intermediate", sessionsPerWeek: 3, pastInjuries: "Sprained ankle twice" }, equipment: "GYM", hazard: /box jump|calf bounce/i },
  { id: "wrist", title: "Wrist pain from typing", lines: ["Age about 41, works at a computer", "Wrists ache when bearing weight", "Wants general fitness", "Beginner, trains at home, 3 days a week"], yes: [], goals: { goalCategory: "General Fitness", experience: "Beginner", sessionsPerWeek: 3, pastInjuries: "Wrist pain from typing" }, equipment: "HOME", hazard: /^Push Up$/i },
  { id: "dizzy", title: "Gets dizzy sometimes", lines: ["Age about 50", "Has felt dizzy a few times; doctor checked and says exercise is fine", "Wants to start slowly", "Beginner, trains at home, 2 days a week"], yes: ["dizzy"], details: { dizzy: "Occasional dizziness, checked by a doctor." }, goals: { goalCategory: "General Fitness", experience: "Beginner", sessionsPerWeek: 2 }, equipment: "HOME", hazard: /handstand|pike push up/i },
  { id: "hip-surgery", title: "Hip surgery 8 months ago", lines: ["Age about 52", "Had a hip operation 8 months ago, surgeon cleared them", "Wants to rebuild strength", "Beginner, full gym, 3 days a week"], yes: ["recent"], details: { recent: "Hip operation 8 months ago." }, goals: { goalCategory: "Strength", experience: "Beginner", sessionsPerWeek: 3, pastInjuries: "Hip surgery" }, equipment: "GYM", hazard: /pistol squat|lunge/i },
  { id: "fit-home", title: "Healthy, trains with no equipment", lines: ["Age about 30, no health problems", "Wants to build muscle at home with just their body", "Intermediate, bodyweight only, 4 days a week"], yes: [], goals: { goalCategory: "Hypertrophy", experience: "Intermediate", sessionsPerWeek: 4 }, equipment: "BODYWEIGHT", hazard: /pistol squat|archer push up|handstand push up/i },
];

export const ARCHETYPE_COUNT = ARCHETYPES.length;

/** "2026-11" for the month containing `now`, in Singapore time. */
export function monthOf(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 7);
}

const blankGoals = (g: Partial<GoalsData>): GoalsData => ({
  mainGoal: "",
  goalCategory: "",
  targetEvent: "",
  targetDate: "",
  experience: "",
  pastInjuries: "",
  days: [],
  times: [],
  sessionsPerWeek: 3,
  sleepHours: 7,
  stress: "",
  workType: "",
  dietNotes: "",
  anythingElse: "",
  ...g,
});

function parqOf(a: Archetype): ParqData {
  const answers: ParqData["answers"] = {};
  for (const q of PARQ_QUESTIONS) answers[q.id] = a.yes.includes(q.id) ? "yes" : "no";
  return { answers, details: a.details ?? {}, other: "" };
}

export interface ReviewCase {
  id: string;
  title: string;
  lines: string[];
  /** Health tags the AI trainer uses for this person (never a name). */
  tags: string[];
  gentle: boolean;
  equipment: TrainerEquipment;
  plan: TrainerPlan;
  /** The planted mistake, if this is the attention-check case. */
  hazardExerciseId?: string;
}

/**
 * The five profiles for a month, with the plan the AI trainer would draft (the current rules already applied) and one planted mistake.
 * The same month always gives the same five, so a coach who comes back to finish sees what they started on.
 */
export function casesForMonth(month: string, library: Exercise[], rules: CoachRule[]): ReviewCase[] {
  const order = ARCHETYPES.map((a, i) => [hashSeed(`${month}:${a.id}`), i] as const).sort((x, y) => x[0] - y[0]).map((x) => ARCHETYPES[x[1]]);
  const chosen = order.slice(0, CASES_PER_REVIEW);
  const hazardAt = hashSeed(`${month}:hazard`) % chosen.length;
  return chosen.map((a, i) => {
    const goals = blankGoals(a.goals);
    const parq = parqOf(a);
    const tags = profileTags({ parq, goals });
    const gentle = screen(parq).gentle;
    const allowed = allowedLibrary(library, { equipment: a.equipment, gentle, tags, rules });
    const plan = buildBasicPlan({ library: allowed, goals, gentle, volumeMod: 0, weekStart: `${month}-01`, seed: `review:${month}:${a.id}` });
    let hazardExerciseId: string | undefined;
    if (i === hazardAt) {
      const bad = library.find((e) => a.hazard.test(e.name));
      const day = plan.days[0];
      if (bad && day && day.exercises.length > 2) {
        day.exercises = day.exercises.filter((e) => e.exerciseId !== bad.id);
        day.exercises.splice(2, 0, { exerciseId: bad.id, sets: day.exercises[0]?.sets ?? 3, repMin: day.exercises[0]?.repMin ?? 8, repMax: day.exercises[0]?.repMax ?? 12 });
        hazardExerciseId = bad.id;
      }
    }
    return { id: a.id, title: a.title, lines: a.lines, tags, gentle, equipment: a.equipment, plan, ...(hazardExerciseId ? { hazardExerciseId } : {}) };
  });
}

/* ---------------- What the coach answers ---------------- */
export interface CaseAnswer {
  caseId: string;
  verdict: Verdict;
  /** Exercise ids the coach took out of the draft plan. */
  removed: string[];
  /** "What should the AI avoid or do differently for someone like this?" */
  avoid: string;
  /** Why: their reasoning, in their own words. */
  why: string;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export type CleanAnswers = { ok: true; answers: CaseAnswer[] } | { ok: false; error: string };

/** Checks the five answers: every case answered once, removed drills really are in that draft, and each answer says why. */
export function cleanAnswers(raw: unknown, cases: ReviewCase[]): CleanAnswers {
  if (!Array.isArray(raw)) return { ok: false, error: "Answer every profile first." };
  const out: CaseAnswer[] = [];
  for (const c of cases) {
    const a = (raw.find((x) => x && typeof x === "object" && (x as { caseId?: unknown }).caseId === c.id) ?? null) as Record<string, unknown> | null;
    if (!a) return { ok: false, error: `Answer "${c.title}" first.` };
    const verdict = VERDICTS.find((v) => v === a.verdict);
    if (!verdict) return { ok: false, error: `Choose safe, needs changes or not safe for "${c.title}".` };
    const inPlan = new Set(c.plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)));
    const removed = Array.isArray(a.removed) ? [...new Set(a.removed.filter((x): x is string => typeof x === "string" && inPlan.has(x)))] : [];
    const avoid = clean(a.avoid, 300);
    const why = clean(a.why, 400);
    if (why.length < 15) return { ok: false, error: `Say why, in a sentence, for "${c.title}".` };
    if (verdict === "CHANGES" && removed.length === 0 && avoid.length < 10) return { ok: false, error: `For "${c.title}", take out at least one exercise or say what to change.` };
    if (verdict === "UNSAFE" && why.length < 30) return { ok: false, error: `Explain a little more why "${c.title}" is not safe.` };
    out.push({ caseId: c.id, verdict, removed, avoid, why });
  }
  return { ok: true, answers: out };
}

const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
function similar(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

export const FLAG_TEXT = {
  rushed: "Finished too quickly to have read five profiles",
  copied: "Reasons are copied or near-identical",
  lowEffort: "Very short reasons and no changes to any plan",
  missedCheck: "Called the plan with the planted mistake safe",
  allSame: "Every answer is 'safe' with nothing changed",
} as const;

/** Reasons a review needs the owner to look before the discount is given. Empty means it passed the automatic checks. */
export function reviewFlags(cases: ReviewCase[], answers: CaseAnswer[], seconds: number): string[] {
  const flags: string[] = [];
  if (seconds < MIN_SECONDS) flags.push(FLAG_TEXT.rushed);
  const whys = answers.map((a) => a.why);
  let copied = false;
  for (let i = 0; i < whys.length; i++) for (let j = i + 1; j < whys.length; j++) if (similar(whys[i], whys[j]) >= 0.85) copied = true;
  const avoids = answers.map((a) => a.avoid).filter((x) => x.length >= 10);
  if (avoids.length >= 3 && new Set(avoids.map((x) => x.toLowerCase())).size === 1) copied = true;
  if (copied) flags.push(FLAG_TEXT.copied);
  const avg = whys.reduce((n, w) => n + w.length, 0) / Math.max(1, whys.length);
  const nothingChanged = answers.every((a) => a.removed.length === 0 && a.avoid.length === 0);
  if (avg < 25 && nothingChanged) flags.push(FLAG_TEXT.lowEffort);
  const hazardCase = cases.find((c) => c.hazardExerciseId);
  if (hazardCase) {
    const a = answers.find((x) => x.caseId === hazardCase.id);
    if (a && a.verdict !== "UNSAFE" && !a.removed.includes(hazardCase.hazardExerciseId as string)) flags.push(FLAG_TEXT.missedCheck);
  }
  if (answers.every((a) => a.verdict === "SAFE") && nothingChanged) flags.push(FLAG_TEXT.allSame);
  return [...new Set(flags)];
}

/* ---------------- Turning approved answers into rules ---------------- */
export interface NewRule extends CoachRule {
  caseId: string;
}

/** What the AI trainer learns from an approved review: drills to keep from people with these tags, and the coach's words. */
export function rulesFromAnswers(cases: ReviewCase[], answers: CaseAnswer[]): NewRule[] {
  const rules: NewRule[] = [];
  for (const c of cases) {
    const a = answers.find((x) => x.caseId === c.id);
    if (!a) continue;
    // A lesson is about the person's health (knee, pregnant, medication...). "Beginner" alone would make it apply to every beginner, so
    // it is only used for a lesson about a healthy beginner.
    const health = c.tags.filter((t) => t !== "beginner");
    const tags = health.length > 0 ? health : c.tags.includes("beginner") ? ["beginner"] : ["any"];
    const text = a.avoid || (a.verdict === "UNSAFE" ? a.why : "");
    if (a.removed.length === 0 && !text) continue;
    rules.push({ caseId: c.id, tags, exerciseIds: a.removed, text: text.slice(0, 300) });
  }
  return rules;
}

/** The rules as instructions for the AI, for the tags this person has. */
export function rulesToPrompt(rules: CoachRule[], tags: string[], max = 12): string[] {
  return rules
    .filter((r) => r.text && (r.tags.includes("any") || r.tags.some((t) => tags.includes(t))))
    .slice(0, max)
    .map((r) => `For someone with ${r.tags.join(" / ")}: ${r.text}`);
}
