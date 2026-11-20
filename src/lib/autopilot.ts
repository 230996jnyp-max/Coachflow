import type { FormKind } from "./intakeForms";

/*
 * Autopilot: rules a coach switches on so the routine messages, forms and nudges go out by themselves, without ever spamming a client.
 * Pure rules, shared by the server, the settings screen and the tests. Every rule is OFF until the coach turns it on, and each trigger is
 * either automatic (sent at once, within the limits below) or a draft the coach approves.
 *
 * The limits that keep a client from being spammed:
 *  - an event can only ever produce one entry (a unique key per client, trigger and event);
 *  - nothing automatic goes out between 9 pm and 8 am Singapore time: it is held until 8 am;
 *  - at most 2 automatic messages a day per client: the rest are held until the next morning;
 *  - nudge-type messages share the 6-hour gap with the manual "Nudge clients" button, so the two never double up.
 */

export const TRIGGER_IDS = [
  "client_joined",
  "package_bought",
  "first_session_booked",
  "session_completed",
  "missed_two_workouts",
  "no_workout_7d",
  "one_credit_left",
  "package_ending",
  "new_pb",
  "pain_high",
] as const;
export type TriggerId = (typeof TRIGGER_IDS)[number];

export type ActionType = "message" | "form" | "program" | "paylink" | "alert";
export type Action =
  | { type: "message"; text: string }
  | { type: "form"; kinds: FormKind[] }
  | { type: "program"; programId: string; startInDays: number }
  | { type: "paylink"; packageId: string }
  | { type: "alert"; text: string };

export type Mode = "auto" | "draft";

export const MAX_ACTIONS = 4;
export const MAX_TEXT = 600;
export const AUTO_PER_DAY = 2;
export const QUIET_START = 21;
export const QUIET_END = 8;
export const NUDGE_GAP_MS = 6 * 3_600_000;

export interface TriggerInfo {
  id: TriggerId;
  label: string;
  /** When it fires, in a sentence. */
  blurb: string;
  /** "nudge" triggers share the 6-hour gap with the manual nudge button. */
  kind: "welcome" | "nudge";
  defaultMode: Mode;
  allowed: ActionType[];
  /** What the starter pack does (all switched off until the coach turns them on). */
  defaults: Action[];
  /** The words a message here can use besides {first_name} and {coach_name}. */
  vars: string[];
}

const MSG: ActionType[] = ["message", "form", "program", "paylink", "alert"];

export const TRIGGERS: Record<TriggerId, TriggerInfo> = {
  client_joined: {
    id: "client_joined",
    label: "A new client joins",
    blurb: "The moment someone becomes your client (you added them, or they joined with your code).",
    kind: "welcome",
    defaultMode: "auto",
    allowed: MSG,
    defaults: [
      { type: "message", text: "Hi {first_name}! Welcome aboard. I'm {coach_name}, your coach. I'll send you a few short forms so I can plan your training properly. Message me any time." },
      { type: "form", kinds: ["PARQ", "DECLARATION", "GOALS"] },
    ],
    vars: [],
  },
  package_bought: {
    id: "package_bought",
    label: "A package is paid",
    blurb: "A client pays for a package (card, PayNow or cash you recorded).",
    kind: "welcome",
    defaultMode: "auto",
    allowed: ["message", "alert", "program"],
    defaults: [{ type: "message", text: "Thanks {first_name}, your package is confirmed! Let's lock in your sessions: which days and times suit you?" }],
    vars: ["package"],
  },
  first_session_booked: {
    id: "first_session_booked",
    label: "A client books their first session",
    blurb: "A client's very first booking with you.",
    kind: "welcome",
    defaultMode: "auto",
    allowed: ["message", "alert", "form"],
    defaults: [{ type: "message", text: "You're booked in, {first_name}! Wear comfy clothes, bring water, and tell me about any niggles before we start." }],
    vars: ["session_date"],
  },
  session_completed: {
    id: "session_completed",
    label: "A session is completed",
    blurb: "You mark a 1-on-1 session as completed.",
    kind: "welcome",
    defaultMode: "draft",
    allowed: ["message", "alert"],
    defaults: [{ type: "message", text: "Great session today, {first_name}! How did it feel? Anything sore, or anything you'd like to change next time?" }],
    vars: [],
  },
  missed_two_workouts: {
    id: "missed_two_workouts",
    label: "Missed 2 assigned workouts",
    blurb: "A client missed two or more of the workouts you assigned in the last 7 days.",
    kind: "nudge",
    defaultMode: "draft",
    allowed: ["message", "alert"],
    defaults: [{ type: "message", text: "Hi {first_name}, I noticed the last couple of workouts didn't get done. Everything OK? I can adjust the plan if the week got busy." }],
    vars: ["missed"],
  },
  no_workout_7d: {
    id: "no_workout_7d",
    label: "No workout in 7 days",
    blurb: "A client who has not finished a workout for a week (new clients get a week of grace).",
    kind: "nudge",
    defaultMode: "draft",
    allowed: ["message", "alert"],
    defaults: [{ type: "message", text: "Hi {first_name}, it's been a week since your last workout. How are you going? Let's get you back on track." }],
    vars: ["days"],
  },
  one_credit_left: {
    id: "one_credit_left",
    label: "1 session credit left",
    blurb: "A client is down to their last session. They already get an automatic alert; this adds a message from you, with an optional pay link.",
    kind: "welcome",
    defaultMode: "draft",
    allowed: ["message", "paylink", "alert"],
    defaults: [{ type: "message", text: "Hi {first_name}, you've got 1 session left in your package. Shall we sort out your next one?" }],
    vars: ["pay_link"],
  },
  package_ending: {
    id: "package_ending",
    label: "Package ending soon",
    blurb: "A package with sessions left runs out within 7 days. They already get an automatic alert; this adds a message from you.",
    kind: "welcome",
    defaultMode: "draft",
    allowed: ["message", "paylink", "alert"],
    defaults: [{ type: "message", text: "Hi {first_name}, your package ends on {expiry_date} and you still have sessions left. Shall we book them in?" }],
    vars: ["expiry_date", "pay_link"],
  },
  new_pb: {
    id: "new_pb",
    label: "A new personal best",
    blurb: "A client finishes a workout with a new personal record.",
    kind: "welcome",
    defaultMode: "draft",
    allowed: ["message", "alert"],
    defaults: [{ type: "message", text: "New personal best, {first_name}! Brilliant work. 🔥" }],
    vars: [],
  },
  pain_high: {
    id: "pain_high",
    label: "Pain of 6 or more after a workout",
    blurb: "A client rates their pain 6 or more out of 10. You are already alerted; this drafts a caring message. It never changes their plan.",
    kind: "nudge",
    defaultMode: "draft",
    allowed: ["message"],
    defaults: [{ type: "message", text: "Sorry to hear that session was tough on your body, {first_name}. Can you tell me where it hurt? We'll adjust your plan." }],
    vars: [],
  },
};

const cleanText = (v: unknown, max = MAX_TEXT) => (typeof v === "string" ? v.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
const FORMS: FormKind[] = ["PARQ", "DECLARATION", "GOALS"];
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

/** Checks a list of actions for a trigger. Returns the cleaned list or a message the coach can read. */
export function cleanActions(trigger: TriggerId, raw: unknown): { actions: Action[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Choose what Autopilot should do." };
  if (raw.length === 0) return { error: "Add at least one thing for Autopilot to do." };
  if (raw.length > MAX_ACTIONS) return { error: `At most ${MAX_ACTIONS} actions per rule.` };
  const allowed = TRIGGERS[trigger].allowed;
  const out: Action[] = [];
  for (const item of raw) {
    const a = item as Record<string, unknown>;
    if (!a || typeof a !== "object" || typeof a.type !== "string" || !(allowed as string[]).includes(a.type)) return { error: "That action is not available for this trigger." };
    if (out.some((o) => o.type === a.type)) return { error: "Each kind of action can only be used once per rule." };
    if (a.type === "message" || a.type === "alert") {
      const text = cleanText(a.text);
      if (!text) return { error: a.type === "message" ? "Write the message." : "Write the alert." };
      out.push({ type: a.type, text });
    } else if (a.type === "form") {
      const kinds = Array.isArray(a.kinds) ? [...new Set(a.kinds.filter((k): k is FormKind => (FORMS as string[]).includes(k as string)))] : [];
      if (kinds.length === 0) return { error: "Choose at least one form." };
      out.push({ type: "form", kinds });
    } else if (a.type === "program") {
      if (typeof a.programId !== "string" || !ID_RE.test(a.programId)) return { error: "Choose a program." };
      const days = Number(a.startInDays);
      out.push({ type: "program", programId: a.programId, startInDays: Number.isInteger(days) && days >= 0 && days <= 60 ? days : 1 });
    } else if (a.type === "paylink") {
      if (typeof a.packageId !== "string" || !ID_RE.test(a.packageId)) return { error: "Choose a package for the pay link." };
      out.push({ type: "paylink", packageId: a.packageId });
    }
  }
  // A {pay_link} in a message needs a pay link action to fill it.
  const msg = out.find((o) => o.type === "message") as { text: string } | undefined;
  if (msg && /\{pay_link\}/.test(msg.text) && !out.some((o) => o.type === "paylink")) return { error: "The message uses {pay_link}, so add a pay link too (or take it out of the message)." };
  return { actions: out };
}

export const isMode = (v: unknown): v is Mode => v === "auto" || v === "draft";

/** Fills {first_name}, {coach_name} and the trigger's own words. Unknown {words} are left as written. */
export function fillText(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** "Ben" from "Ben Andrew", "Darsh" from "Coach Darsh (demo owner)". */
export function firstNameOf(full: string): string {
  const parts = full.replace(/\(.*?\)/g, "").trim().split(/\s+/);
  return ((/^coach$/i.test(parts[0]) && parts[1] ? parts[1] : parts[0]) || "there").slice(0, 40);
}

/* ---------------- Time (Singapore) ---------------- */
const SG = 8 * 3_600_000;
const sgParts = (d: Date) => {
  const t = new Date(d.getTime() + SG);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDate(), h: t.getUTCHours() };
};
/** The Singapore calendar day (yyyy-MM-dd) of a moment. */
export const sgDay = (d: Date): string => new Date(d.getTime() + SG).toISOString().slice(0, 10);

/** Between 9 pm and 8 am in Singapore: nothing automatic is sent. */
export const inQuietHours = (d: Date): boolean => {
  const h = sgParts(d).h;
  return h >= QUIET_START || h < QUIET_END;
};

/** The next 8 am in Singapore at or after `d` (the moment held messages are let go). */
export function nextMorning(d: Date): Date {
  const p = sgParts(d);
  const today8 = Date.UTC(p.y, p.m, p.day, QUIET_END) - SG;
  return new Date(p.h < QUIET_END ? today8 : today8 + 86_400_000);
}

export type Decision = { send: true } | { send: false; hold: Date; why: "quiet" | "cap" };

/**
 * What to do with an automatic message right now: send it, or hold it until a morning. `sentToday` is how many automatic messages this
 * client already got today (Singapore day).
 */
export function decideAuto(now: Date, sentToday: number): Decision {
  if (inQuietHours(now)) return { send: false, hold: nextMorning(now), why: "quiet" };
  if (sentToday >= AUTO_PER_DAY) return { send: false, hold: nextMorning(now), why: "cap" };
  return { send: true };
}

/** Monday (yyyy-MM-dd) of the Singapore week a moment falls in: the key for "once a week" triggers. */
export function weekKey(d: Date): string {
  const t = new Date(d.getTime() + SG);
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

/* ---------------- Smart replies ---------------- */
export const TONES = ["formal", "casual", "excited"] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABEL: Record<Tone, string> = { formal: "Formal: clear, polished, confident", casual: "Casual: warm and conversational", excited: "Excited: positive and encouraging" };
export const SMART_REPLIES_PER_DAY = 50;
export const isTone = (v: unknown): v is Tone => (TONES as readonly string[]).includes(v as string);

/** Keeps a drafted reply to plain text of a sensible length. */
export function cleanReply(v: unknown): string {
  const t = typeof v === "string" ? v.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "";
  return t.slice(0, MAX_TEXT);
}
