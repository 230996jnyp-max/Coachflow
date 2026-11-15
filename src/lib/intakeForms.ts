/*
 * The "Before we meet" forms: a health questionnaire (PAR-Q style), a health declaration with consent, and a goals and lifestyle form.
 * Shared by the browser (to draw and check them) and the server (which checks everything again). Pure: no imports, no database.
 *
 * The wording is our own, in plain language. It follows the usual PAR-Q ideas but is not a copy of any official form, and it is a way for
 * a coach to understand a client before the first session, not medical advice.
 */

export const FORM_KINDS = ["PARQ", "DECLARATION", "GOALS"] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export const FORM_LABEL: Record<FormKind, string> = {
  PARQ: "Health questionnaire",
  DECLARATION: "Health declaration",
  GOALS: "Goals and lifestyle",
};

export const FORM_BLURB: Record<FormKind, string> = {
  PARQ: "A few yes or no questions about your health, so your coach knows what to look out for.",
  DECLARATION: "Confirm your answers are true and agree to how your coach will work with you.",
  GOALS: "What you want to achieve, and what your week looks like.",
};

/** What every form says at the top about the information the client is giving. */
export const PRIVACY_NOTE =
  "What you write here is private health information. It is stored encrypted, and only you and your coach can see it. Your gym, if your coach has one, never sees it. You can update your answers any time, your coach keeps each version, and your coach shares a copy back with you so you can see exactly what was recorded.";

/** The same promise, worded for the coach reading it. */
export const PRIVACY_NOTE_COACH =
  "This is private health information. It is stored encrypted, and only you and this client can see it. A gym you work with never sees it, and neither does a coach covering a session. Every version is kept, and you give the client a copy so they can see exactly what you recorded. Deleting the client deletes it.";

/* ---------------- Health questionnaire ---------------- */
export const PARQ_QUESTIONS = [
  { id: "heart", text: "Has a doctor ever told you that you have a heart condition, or that you should only exercise with medical supervision?" },
  { id: "chest", text: "Do you feel pain in your chest when you exercise, or have you had chest pain at rest in the last month?" },
  { id: "dizzy", text: "Do you lose your balance because of dizziness, or have you ever fainted or lost consciousness?" },
  { id: "joints", text: "Do you have a bone, joint, muscle or back problem that could get worse if you become more active?" },
  { id: "meds", text: "Do you take medication for blood pressure, a heart condition or another long-term health condition?" },
  { id: "recent", text: "Have you had surgery, a serious injury or an illness in the last 12 months?" },
  { id: "other", text: "Do you know of any other reason you should not exercise, or has a doctor advised you against it?" },
  { id: "pregnant", text: "Are you pregnant, or have you given birth in the last 6 months? (Answer no if this doesn't apply.)" },
] as const;
export type ParqId = (typeof PARQ_QUESTIONS)[number]["id"];

export interface ParqData {
  answers: Partial<Record<ParqId, "yes" | "no">>;
  /** "Tell us more" for a yes. */
  details: Partial<Record<ParqId, string>>;
  other: string;
}

/** How many questions were answered yes. Any yes means "medical clearance recommended" (a warning for the coach, never a block). */
export const parqFlags = (d: Pick<ParqData, "answers">): ParqId[] => PARQ_QUESTIONS.filter((q) => d.answers[q.id] === "yes").map((q) => q.id);

export const CLEARANCE_MESSAGE = "Answered yes to at least one question. Medical clearance from a doctor is recommended before training hard. This is a flag for you, not a block.";

/* ---------------- Health declaration ---------------- */
export const DECLARATION_STATEMENTS = [
  "The answers I have given about my health are true and complete as far as I know.",
  "I understand that exercise carries some risk, and I take part by my own choice.",
  "I will tell my coach straight away if my health changes, or if something hurts or feels wrong during a session.",
  "I agree that my coach may keep notes, measurements and photos about my training to plan my sessions, and that I can ask to see them.",
] as const;

export interface DeclarationData {
  agreed: boolean;
  typedName: string;
  /** The day it was signed (yyyy-MM-dd). */
  date: string;
  /** An optional drawn signature, as a small PNG data URL. */
  signature?: string;
  /** Under 18: the parent or guardian who agrees. */
  guardianName?: string;
  emergencyName: string;
  emergencyPhone: string;
}

/* ---------------- Goals and lifestyle ---------------- */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const TIMES = ["Early morning", "Morning", "Lunchtime", "Afternoon", "Evening", "Late night"] as const;
export const STRESS_LEVELS = ["Low", "Medium", "High"] as const;
export const WORK_TYPES = ["Desk or sitting", "On my feet", "Physical or manual", "Mixed", "Not working"] as const;
export const EXPERIENCE = ["Beginner", "Intermediate", "Advanced"] as const;
export const GOAL_CATEGORIES = ["Hypertrophy", "Fat Loss", "Strength", "Conditioning", "General Fitness"] as const;

export interface GoalsData {
  mainGoal: string;
  goalCategory: (typeof GOAL_CATEGORIES)[number] | "";
  targetEvent: string;
  /** yyyy-MM-dd, or "". */
  targetDate: string;
  experience: (typeof EXPERIENCE)[number] | "";
  pastInjuries: string;
  days: string[];
  times: string[];
  sessionsPerWeek: number;
  sleepHours: number;
  stress: (typeof STRESS_LEVELS)[number] | "";
  workType: (typeof WORK_TYPES)[number] | "";
  dietNotes: string;
  anythingElse: string;
}

export type FormData = { PARQ: ParqData; DECLARATION: DeclarationData; GOALS: GoalsData };

const txt = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const one = <T extends string>(v: unknown, list: readonly T[]): T | "" => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : "");
const many = (v: unknown, list: readonly string[]): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && list.includes(x)))] : []);
const isoDate = (v: unknown): string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100 ? "" : v;
};
const SIGNATURE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export type CleanResult<K extends FormKind> = { ok: true; data: FormData[K] } | { ok: false; error: string };

/** Checks what a client sent for a form and keeps only known, valid fields. `minor` makes a guardian's name compulsory on the declaration. */
export function cleanForm<K extends FormKind>(kind: K, raw: unknown, opts: { minor?: boolean; today?: string } = {}): CleanResult<K> {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  if (kind === "PARQ") {
    const answers: ParqData["answers"] = {};
    const details: ParqData["details"] = {};
    const a = (r.answers && typeof r.answers === "object" ? r.answers : {}) as Record<string, unknown>;
    const d = (r.details && typeof r.details === "object" ? r.details : {}) as Record<string, unknown>;
    for (const q of PARQ_QUESTIONS) {
      if (a[q.id] !== "yes" && a[q.id] !== "no") return { ok: false, error: "Please answer every question, yes or no." } as CleanResult<K>;
      answers[q.id] = a[q.id] as "yes" | "no";
      const t = txt(d[q.id], 300);
      if (t) details[q.id] = t;
    }
    return { ok: true, data: { answers, details, other: txt(r.other, 600) } as FormData[K] };
  }
  if (kind === "DECLARATION") {
    if (r.agreed !== true) return { ok: false, error: "Please tick the box to agree." } as CleanResult<K>;
    const typedName = txt(r.typedName, 100);
    if (typedName.length < 2) return { ok: false, error: "Type your full name to sign." } as CleanResult<K>;
    const guardianName = txt(r.guardianName, 100);
    if (opts.minor && guardianName.length < 2) return { ok: false, error: "Under 18: a parent or guardian must complete this. Type their full name." } as CleanResult<K>;
    const emergencyName = txt(r.emergencyName, 100);
    const emergencyPhone = txt(r.emergencyPhone, 30);
    if (emergencyPhone && !/^[0-9+()\-.\s]{6,30}$/.test(emergencyPhone)) return { ok: false, error: "The emergency contact's phone number doesn't look valid." } as CleanResult<K>;
    const signature = typeof r.signature === "string" && SIGNATURE.test(r.signature) && r.signature.length < 120_000 ? r.signature : undefined;
    const data: DeclarationData = { agreed: true, typedName, date: opts.today ?? new Date().toISOString().slice(0, 10), ...(signature ? { signature } : {}), ...(guardianName ? { guardianName } : {}), emergencyName, emergencyPhone };
    return { ok: true, data: data as FormData[K] };
  }
  const mainGoal = txt(r.mainGoal, 300);
  if (mainGoal.length < 3) return { ok: false, error: "Tell your coach your main goal." } as CleanResult<K>;
  const spw = Number(r.sessionsPerWeek);
  const sleep = Number(r.sleepHours);
  const data: GoalsData = {
    mainGoal,
    goalCategory: one(r.goalCategory, GOAL_CATEGORIES),
    targetEvent: txt(r.targetEvent, 80),
    targetDate: isoDate(r.targetDate),
    experience: one(r.experience, EXPERIENCE),
    pastInjuries: txt(r.pastInjuries, 600),
    days: many(r.days, WEEKDAYS),
    times: many(r.times, TIMES),
    sessionsPerWeek: Number.isInteger(spw) && spw >= 1 && spw <= 7 ? spw : 3,
    sleepHours: Number.isFinite(sleep) && sleep >= 2 && sleep <= 14 ? Math.round(sleep * 2) / 2 : 7,
    stress: one(r.stress, STRESS_LEVELS),
    workType: one(r.workType, WORK_TYPES),
    dietNotes: txt(r.dietNotes, 600),
    anythingElse: txt(r.anythingElse, 600),
  };
  return { ok: true, data: data as FormData[K] };
}

export const emptyGoals = (): GoalsData => ({ mainGoal: "", goalCategory: "", targetEvent: "", targetDate: "", experience: "", pastInjuries: "", days: [], times: [], sessionsPerWeek: 3, sleepHours: 7, stress: "", workType: "", dietNotes: "", anythingElse: "" });
export const emptyParq = (): ParqData => ({ answers: {}, details: {}, other: "" });

/** The one-line summary kept in a client's medical notes (replaced each time they answer again). */
export const HEALTH_NOTE_MARK = "[Health form";
export function healthNoteLine(d: ParqData, date: string): string {
  const yes = parqFlags(d).map((id) => PARQ_QUESTIONS.find((q) => q.id === id)!.id);
  const names: Record<string, string> = { heart: "heart", chest: "chest pain", dizzy: "dizziness", joints: "joints or back", meds: "medication", recent: "recent surgery or injury", other: "other reason", pregnant: "pregnancy" };
  return `${HEALTH_NOTE_MARK} ${date}] ${yes.length ? `Yes to: ${yes.map((i) => names[i]).join(", ")}. Medical clearance recommended.` : "No flags."}`;
}

/** Puts the health line in the notes (replacing an older one) without touching anything else the coach wrote. */
export function withHealthLine(notes: string, line: string): string {
  const kept = notes
    .split("\n")
    .filter((l) => !l.startsWith(HEALTH_NOTE_MARK))
    .join("\n")
    .trim();
  return (kept ? `${line}\n${kept}` : line).slice(0, 2000);
}

/** Who has done what: used for the checklist on the coach's side and the "Before we meet" card on the client's. */
export interface FormStatus {
  kind: FormKind;
  submittedAt: string | null;
  version: number;
  flags: number;
}
export const packComplete = (statuses: FormStatus[], kinds: readonly FormKind[] = FORM_KINDS): boolean => kinds.every((k) => statuses.some((s) => s.kind === k && s.submittedAt));
