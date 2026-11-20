import type { TemplateExercise } from "./types";

/*
 * Programs: a multi-week plan (week 1..12, day 1..7, up to 3 workouts a day) a coach builds once and assigns to many clients, or a person
 * with no coach builds for themselves. Pure rules, shared by the server, the planner screen and the tests.
 *
 * Progression is worked out by code, not by the AI: the AI only designs the first week, then expandWeeks() grows it into the whole block
 * (more reps, then more weight, with an easier deload week every fourth week). That keeps the numbers predictable and the AI cost small.
 */

export const MAX_WEEKS = 12;
export const MAX_DAYS = 7;
export const MAX_PER_DAY = 3;
export const MAX_EXERCISES = 20;
export const MAX_SETS = 10;
export const MAX_EDITS = 10;
export const MAX_NAME = 80;

export type ProgramSource = "manual" | "ai" | "starter" | "import";
export type ProgressionMode = "reps_then_weight" | "linear" | "effort";
export const PROGRESSION_LABEL: Record<ProgressionMode, string> = {
  reps_then_weight: "Add reps first, then weight",
  linear: "Add a little weight every week",
  effort: "Build the effort (RPE) each week",
};

export interface ProgramSlot {
  id: string;
  /** 1 to 12. */
  week: number;
  /** 1 to 7: day 1 is the day the program starts. */
  day: number;
  title: string;
  note?: string;
  exercises: TemplateExercise[];
}

export interface Program {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  weeks: number;
  goal: string;
  level: string;
  source: ProgramSource;
  /** Built for a "gentle" plan (health screening): no jumping or heavy bar lifts, modest sets and reps. */
  gentle: boolean;
  /** Built for someone under 18: no max-effort sets, never fewer than 8 reps. */
  minor: boolean;
  slots: ProgramSlot[];
  /** How many chat edits have been used (10 allowed). */
  edits: number;
  /** Goes up on every change; clients on Live Sync are brought up to date when it does. */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** The last chat edit can be undone. */
  canUndo?: boolean;
}

const clampInt = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const roundKg = (w: number) => Math.round(w * 2) / 2;

/** One exercise line, with every number kept inside a sensible range. */
export function cleanExercise(raw: unknown, opts: { gentle?: boolean; minor?: boolean } = {}): TemplateExercise | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  if (typeof x.exerciseId !== "string" || !ID_RE.test(x.exerciseId)) return null;
  const timed = typeof x.durationSec === "number" && x.durationSec > 0;
  let repMin = clampInt(x.repMin, 0, 100, timed ? 0 : 8);
  let repMax = Math.max(repMin, clampInt(x.repMax, 0, 100, repMin));
  let sets = clampInt(x.sets, 1, MAX_SETS, 3);
  if (!timed) {
    if (opts.gentle) {
      sets = Math.min(sets, 3);
      repMin = Math.max(repMin, 10);
      repMax = Math.max(repMax, Math.min(15, repMin + 5));
    }
    if (opts.minor) {
      sets = Math.min(sets, 4);
      repMin = Math.max(repMin, 8);
      repMax = Math.max(repMax, repMin);
    }
  }
  const out: TemplateExercise = { exerciseId: x.exerciseId, sets, repMin, repMax };
  if (typeof x.weight === "number" && Number.isFinite(x.weight) && x.weight > 0 && x.weight <= 1000) out.weight = roundKg(x.weight);
  if (timed) out.durationSec = clampInt(x.durationSec, 5, 7200, 60);
  if (typeof x.distanceKm === "number" && Number.isFinite(x.distanceKm) && x.distanceKm > 0 && x.distanceKm <= 500) out.distanceKm = Math.round(x.distanceKm * 100) / 100;
  const notes = clean(x.notes, 200);
  if (notes) out.notes = notes;
  return out;
}

let counter = 0;
const slotId = () => `ps_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Checks a program the browser (or the AI) sent: every number clamped, the day limits enforced. Returns an error message when it cannot be saved. */
export function cleanSlots(raw: unknown, weeks: number, opts: { gentle?: boolean; minor?: boolean } = {}): { slots: ProgramSlot[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "The program has no workouts yet." };
  const slots: ProgramSlot[] = [];
  const perDay = new Map<string, number>();
  for (const item of raw.slice(0, MAX_WEEKS * MAX_DAYS * MAX_PER_DAY)) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const week = clampInt(s.week, 1, MAX_WEEKS, 0);
    const day = clampInt(s.day, 1, MAX_DAYS, 0);
    if (!week || !day || week > weeks) continue;
    if (!Array.isArray(s.exercises)) continue;
    const exercises = s.exercises.slice(0, MAX_EXERCISES).map((e) => cleanExercise(e, opts)).filter((e): e is TemplateExercise => e !== null);
    if (exercises.length === 0) continue;
    const key = `${week}:${day}`;
    const n = (perDay.get(key) ?? 0) + 1;
    if (n > MAX_PER_DAY) return { error: `Week ${week}, day ${day} has more than ${MAX_PER_DAY} workouts.` };
    perDay.set(key, n);
    const id = typeof s.id === "string" && ID_RE.test(s.id) ? s.id : slotId();
    const note = clean(s.note, 500);
    slots.push({ id, week, day, title: clean(s.title, 120) || `Week ${week} · Day ${day}`, ...(note ? { note } : {}), exercises });
  }
  if (slots.length === 0) return { error: "Add at least one workout with an exercise." };
  if (new Set(slots.map((s) => s.id)).size !== slots.length) for (const s of slots.slice(1)) if (slots.filter((x) => x.id === s.id).length > 1) s.id = slotId();
  return { slots: sortSlots(slots) };
}

export const sortSlots = (slots: ProgramSlot[]): ProgramSlot[] => [...slots].sort((a, b) => a.week - b.week || a.day - b.day || a.id.localeCompare(b.id));

/* ---------------- Growing week 1 into the whole block ---------------- */
export const isDeloadWeek = (week: number, weeks: number): boolean => weeks >= 4 && week > 1 && week % 4 === 0;

/**
 * Takes the workouts of week 1 and makes every week up to `weeks`.
 *  - Add reps first, then weight: reps climb one a week from the bottom of the range to the top, then the weight goes up 2.5% and reps start again.
 *  - Linear: the weight goes up 2.5 kg a week (reps stay).
 *  - Effort: like reps then weight, with an RPE target that builds across the block.
 * Every 4th week is an easier deload (a third fewer sets, 10% lighter, bottom of the rep range). Exercises with no weight set keep to reps and time.
 */
export function expandWeeks(week1: ProgramSlot[], weeks: number, mode: ProgressionMode = "reps_then_weight"): ProgramSlot[] {
  const base = sortSlots(week1.filter((s) => s.week === 1));
  const out: ProgramSlot[] = [];
  for (let w = 1; w <= weeks; w++) {
    const deload = isDeloadWeek(w, weeks);
    // How many progressive (non-deload) steps came before this week.
    let p = 0;
    for (let k = 2; k <= w; k++) if (!isDeloadWeek(k, weeks)) p++;
    for (const slot of base) {
      const exercises = slot.exercises.map((e): TemplateExercise => {
        if (w === 1) return { ...e };
        const next: TemplateExercise = { ...e };
        const timed = typeof e.durationSec === "number" && e.durationSec > 0;
        if (deload) {
          next.sets = Math.max(1, Math.min(e.sets, Math.max(2, Math.round(e.sets * 0.67))));
          if (!timed) next.repMax = next.repMin = e.repMin;
          if (typeof e.weight === "number") next.weight = roundKg(e.weight * 0.9);
          if (timed && e.durationSec) next.durationSec = Math.max(5, Math.round((e.durationSec * 0.7) / 5) * 5);
          next.notes = [e.notes, "Deload week: easier on purpose"].filter(Boolean).join(" · ").slice(0, 200);
          return next;
        }
        if (timed) {
          next.durationSec = Math.round(((e.durationSec ?? 60) * (1 + 0.1 * p)) / 5) * 5;
          return next;
        }
        if (mode === "linear") {
          if (typeof e.weight === "number") next.weight = roundKg(e.weight + 2.5 * p);
          else next.repMin = next.repMax = Math.min(100, e.repMin + (p > 0 && p % 2 === 0 ? 1 : 0));
          return next;
        }
        const span = Math.max(1, e.repMax - e.repMin + 1);
        const cycle = Math.floor(p / span);
        const inCycle = p % span;
        const target = e.repMin + inCycle;
        next.repMin = next.repMax = target;
        if (typeof e.weight === "number") next.weight = roundKg(e.weight * (1 + 0.025 * cycle));
        if (mode === "effort") next.notes = [e.notes, `Aim for RPE ${Math.min(9, 7 + Math.floor(p / 2))}`].filter(Boolean).join(" · ").slice(0, 200);
        return next;
      });
      out.push({ ...slot, id: slotId(), week: w, exercises });
    }
  }
  return out;
}

/* ---------------- Dates ---------------- */
/** The calendar day (yyyy-MM-dd) a slot falls on when the program starts on `start`: day 1 of week 1 is the start date. */
export function slotDate(start: string, slot: Pick<ProgramSlot, "week" | "day">): string {
  const [y, m, d] = start.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + (slot.week - 1) * 7 + (slot.day - 1)));
  return t.toISOString().slice(0, 10);
}

export const programEnd = (start: string, weeks: number): string => slotDate(start, { week: weeks, day: 7 });

/* ---------------- Editing: the operations the planner and the chat use ---------------- */
export type Op =
  | { op: "swap"; from: string; to: string; weeks?: number[] }
  | { op: "remove"; exerciseId: string; weeks?: number[] }
  | { op: "sets"; delta: number; weeks?: number[] }
  | { op: "reps"; delta: number; weeks?: number[] }
  | { op: "weight_pct"; pct: number; weeks?: number[] }
  | { op: "deload"; weeks: number[] }
  | { op: "add"; exerciseId: string; sets: number; repMin: number; repMax: number; weeks?: number[]; day?: number };

const weeksOf = (raw: unknown, max: number): number[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const list = [...new Set(raw.map((n) => (typeof n === "number" ? Math.round(n) : NaN)).filter((n) => n >= 1 && n <= max))];
  return list.length ? list : undefined;
};

/** The AI's list of changes, kept to the operations we know and to exercises we allow. Anything else is dropped. */
export function cleanOps(raw: unknown, weeks: number, known: (id: string) => boolean): Op[] {
  if (!Array.isArray(raw)) return [];
  const out: Op[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const w = weeksOf(o.weeks, weeks);
    const id = (v: unknown) => (typeof v === "string" && known(v) ? v : null);
    switch (o.op) {
      case "swap": {
        const from = typeof o.from === "string" ? o.from : null;
        const to = id(o.to);
        if (from && to && from !== to) out.push({ op: "swap", from, to, ...(w ? { weeks: w } : {}) });
        break;
      }
      case "remove":
        if (typeof o.exerciseId === "string") out.push({ op: "remove", exerciseId: o.exerciseId, ...(w ? { weeks: w } : {}) });
        break;
      case "sets":
        if (typeof o.delta === "number" && o.delta !== 0) out.push({ op: "sets", delta: Math.max(-3, Math.min(3, Math.round(o.delta))), ...(w ? { weeks: w } : {}) });
        break;
      case "reps":
        if (typeof o.delta === "number" && o.delta !== 0) out.push({ op: "reps", delta: Math.max(-5, Math.min(5, Math.round(o.delta))), ...(w ? { weeks: w } : {}) });
        break;
      case "weight_pct":
        if (typeof o.pct === "number" && o.pct !== 0) out.push({ op: "weight_pct", pct: Math.max(-30, Math.min(30, Math.round(o.pct))), ...(w ? { weeks: w } : {}) });
        break;
      case "deload":
        if (w) out.push({ op: "deload", weeks: w });
        break;
      case "add": {
        const e = id(o.exerciseId);
        if (e) out.push({ op: "add", exerciseId: e, sets: clampInt(o.sets, 1, 6, 3), repMin: clampInt(o.repMin, 1, 30, 10), repMax: clampInt(o.repMax, 1, 30, 12), ...(w ? { weeks: w } : {}), ...(typeof o.day === "number" ? { day: clampInt(o.day, 1, MAX_DAYS, 1) } : {}) });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export interface ApplyResult {
  slots: ProgramSlot[];
  /** One plain-English line per change that did something. */
  notes: string[];
  /** Changes that matched nothing (for example "swap squats" when the program has no squats). */
  skipped: string[];
}

/** Applies a list of changes. `nameOf` turns an exercise id into words for the summary lines. */
export function applyOps(slots: ProgramSlot[], ops: Op[], opts: { gentle?: boolean; minor?: boolean; nameOf?: (id: string) => string } = {}): ApplyResult {
  const nameOf = opts.nameOf ?? ((id: string) => id);
  let cur = slots.map((s) => ({ ...s, exercises: s.exercises.map((e) => ({ ...e })) }));
  const notes: string[] = [];
  const skipped: string[] = [];
  const inWeeks = (s: ProgramSlot, weeks?: number[]) => !weeks || weeks.includes(s.week);
  const where = (weeks?: number[]) => (weeks ? ` in week${weeks.length > 1 ? "s" : ""} ${weeks.join(", ")}` : "");
  const touch = (fn: (e: TemplateExercise, s: ProgramSlot) => TemplateExercise | null, weeks?: number[]) => {
    let n = 0;
    cur = cur.map((s) => {
      if (!inWeeks(s, weeks)) return s;
      const exercises: TemplateExercise[] = [];
      for (const e of s.exercises) {
        const r = fn(e, s);
        if (r === null) {
          n++;
          continue;
        }
        if (r !== e) n++;
        exercises.push(r);
      }
      return { ...s, exercises };
    });
    return n;
  };
  for (const op of ops) {
    if (op.op === "swap") {
      const n = touch((e) => (e.exerciseId === op.from ? { ...e, exerciseId: op.to } : e), op.weeks);
      if (n) notes.push(`Swapped ${nameOf(op.from)} for ${nameOf(op.to)}${where(op.weeks)}.`);
      else skipped.push(`There was no ${nameOf(op.from)} to swap${where(op.weeks)}.`);
    } else if (op.op === "remove") {
      const n = touch((e) => (e.exerciseId === op.exerciseId ? null : e), op.weeks);
      if (n) notes.push(`Removed ${nameOf(op.exerciseId)}${where(op.weeks)}.`);
      else skipped.push(`There was no ${nameOf(op.exerciseId)} to remove${where(op.weeks)}.`);
    } else if (op.op === "sets") {
      const n = touch((e) => (e.sets + op.delta === e.sets ? e : { ...e, sets: Math.max(1, Math.min(MAX_SETS, e.sets + op.delta)) }), op.weeks);
      if (n) notes.push(`${op.delta > 0 ? "Added" : "Took off"} ${Math.abs(op.delta)} set${Math.abs(op.delta) === 1 ? "" : "s"} per exercise${where(op.weeks)}.`);
    } else if (op.op === "reps") {
      const n = touch((e) => (e.durationSec ? e : { ...e, repMin: Math.max(1, e.repMin + op.delta), repMax: Math.max(1, e.repMax + op.delta) }), op.weeks);
      if (n) notes.push(`${op.delta > 0 ? "Added" : "Took off"} ${Math.abs(op.delta)} rep${Math.abs(op.delta) === 1 ? "" : "s"}${where(op.weeks)}.`);
    } else if (op.op === "weight_pct") {
      const n = touch((e) => (typeof e.weight === "number" ? { ...e, weight: roundKg(e.weight * (1 + op.pct / 100)) } : e), op.weeks);
      if (n) notes.push(`${op.pct > 0 ? "Raised" : "Lowered"} the weights by ${Math.abs(op.pct)}%${where(op.weeks)}.`);
      else skipped.push("No exercise has a weight set, so there was nothing to change.");
    } else if (op.op === "deload") {
      const n = touch(
        (e) => ({
          ...e,
          sets: Math.max(1, Math.min(e.sets, Math.max(2, Math.round(e.sets * 0.67)))),
          ...(typeof e.weight === "number" ? { weight: roundKg(e.weight * 0.9) } : {}),
          notes: [e.notes, "Deload week: easier on purpose"].filter(Boolean).join(" · ").slice(0, 200),
        }),
        op.weeks,
      );
      if (n) notes.push(`Made week${op.weeks.length > 1 ? "s" : ""} ${op.weeks.join(", ")} a lighter deload.`);
    } else if (op.op === "add") {
      let n = 0;
      const dayOne = new Map<number, number>();
      for (const s of cur) if (inWeeks(s, op.weeks) && (op.day === undefined || s.day === op.day) && !dayOne.has(s.week)) dayOne.set(s.week, s.day);
      cur = cur.map((s) => {
        if (!inWeeks(s, op.weeks) || (op.day === undefined ? dayOne.get(s.week) !== s.day : s.day !== op.day)) return s;
        if (s.exercises.length >= MAX_EXERCISES || s.exercises.some((e) => e.exerciseId === op.exerciseId)) return s;
        n++;
        return { ...s, exercises: [...s.exercises, { exerciseId: op.exerciseId, sets: op.sets, repMin: Math.min(op.repMin, op.repMax), repMax: Math.max(op.repMin, op.repMax) }] };
      });
      if (n) notes.push(`Added ${nameOf(op.exerciseId)}${where(op.weeks)}.`);
    }
  }
  // Whatever was asked for, the plan keeps to its safety limits.
  const fixed: ProgramSlot[] = [];
  for (const s of cur) {
    const exercises = s.exercises.map((e) => cleanExercise(e, opts)).filter((e): e is TemplateExercise => e !== null);
    if (exercises.length) fixed.push({ ...s, exercises });
  }
  return { slots: fixed, notes, skipped };
}

/** A one-line description of a program for lists ("8 weeks · 3 days a week · 24 workouts"). */
export function describeProgram(p: Pick<Program, "weeks" | "slots">): string {
  const days = new Set(p.slots.filter((s) => s.week === 1).map((s) => s.day)).size;
  return `${p.weeks} week${p.weeks === 1 ? "" : "s"} · ${days} day${days === 1 ? "" : "s"} a week · ${p.slots.length} workout${p.slots.length === 1 ? "" : "s"}`;
}

/** Copies one week's workouts onto other weeks (replacing what was there). */
export function copyWeek(slots: ProgramSlot[], from: number, to: number[]): ProgramSlot[] {
  const src = slots.filter((s) => s.week === from);
  const keep = slots.filter((s) => !to.includes(s.week));
  const made = to.flatMap((w) => src.map((s) => ({ ...s, id: slotId(), week: w, exercises: s.exercises.map((e) => ({ ...e })) })));
  return sortSlots([...keep, ...made]);
}

/** Moves a workout to another day of the same week (or another week), when that day has room. */
export function moveSlot(slots: ProgramSlot[], id: string, week: number, day: number): ProgramSlot[] | null {
  const s = slots.find((x) => x.id === id);
  if (!s) return null;
  if (s.week === week && s.day === day) return slots;
  if (slots.filter((x) => x.week === week && x.day === day && x.id !== id).length >= MAX_PER_DAY) return null;
  return sortSlots(slots.map((x) => (x.id === id ? { ...x, week, day } : x)));
}

/** Exercise ids a program uses, for loading names. */
export const exerciseIdsOf = (slots: ProgramSlot[]): string[] => [...new Set(slots.flatMap((s) => s.exercises.map((e) => e.exerciseId)))];
