/*
 * Posture and fitness assessment: what is checked, how a record is cleaned and compared, and a plain "what to work on besides muscle"
 * summary worked out from the findings by fixed rules (no AI needed). Shared by the browser and the server. Pure: no imports.
 */

export type Rating = "normal" | "mild" | "notable";
export const RATINGS: Rating[] = ["normal", "mild", "notable"];
export const RATING_LABEL: Record<Rating, string> = { normal: "Normal", mild: "Mild", notable: "Notable" };

export const POSTURE_ITEMS = [
  { id: "head_forward", label: "Head and neck", view: "Side", hint: "Head sits forward of the shoulders" },
  { id: "shoulders_rounded", label: "Rounded shoulders", view: "Side", hint: "Shoulders roll forward" },
  { id: "shoulder_height", label: "Uneven shoulders", view: "Front or back", hint: "One shoulder higher than the other" },
  { id: "upper_back", label: "Upper-back rounding", view: "Side", hint: "Rounded upper back" },
  { id: "lower_back", label: "Lower-back curve", view: "Side", hint: "Very arched or very flat" },
  { id: "pelvic_tilt", label: "Pelvic tilt", view: "Side", hint: "Pelvis tipped forward or back" },
  { id: "hip_level", label: "Uneven hips", view: "Front or back", hint: "One hip higher than the other" },
  { id: "knee_align", label: "Knee alignment", view: "Front", hint: "Knees collapse in or bow out" },
  { id: "foot_arch", label: "Feet and ankles", view: "Front or back", hint: "Flat arches, or feet turning out or in" },
] as const;
export type PostureId = (typeof POSTURE_ITEMS)[number]["id"];

export const MOVEMENT_ITEMS = [
  { id: "overhead_squat", label: "Overhead squat", sided: false },
  { id: "single_leg_balance", label: "Single-leg balance", sided: true },
  { id: "hip_hinge", label: "Hip hinge", sided: false },
  { id: "shoulder_mobility", label: "Shoulder mobility", sided: true },
  { id: "pushup", label: "Push-up", sided: false },
  { id: "plank", label: "Plank hold", sided: false },
] as const;
export type MovementId = (typeof MOVEMENT_ITEMS)[number]["id"];

/** 0 to 3, like common movement screens. */
export const SCORE_LABEL = ["0 · Pain", "1 · Can't do it", "2 · With compensation", "3 · Clean"] as const;

export const TEST_FIELDS = [
  { id: "restingHr", label: "Resting heart rate", unit: "bpm", min: 30, max: 200 },
  { id: "bpSys", label: "Blood pressure, top number", unit: "mmHg", min: 70, max: 260 },
  { id: "bpDia", label: "Blood pressure, bottom number", unit: "mmHg", min: 40, max: 160 },
  { id: "weightKg", label: "Body weight", unit: "kg", min: 20, max: 400 },
  { id: "bodyFatPct", label: "Body fat", unit: "%", min: 2, max: 70 },
  { id: "pushups60", label: "Push-ups in 60 seconds", unit: "reps", min: 0, max: 200 },
  { id: "plankSec", label: "Plank hold", unit: "sec", min: 0, max: 1800 },
  { id: "sitReachCm", label: "Sit-and-reach", unit: "cm", min: -40, max: 60 },
] as const;
export type TestId = (typeof TEST_FIELDS)[number]["id"];

export interface PostureEntry {
  rating: Rating | "";
  note: string;
}
export interface OtherEntry extends PostureEntry {
  /** Stays the same from one assessment to the next, so the same item lines up over time. */
  id: string;
  name: string;
}
export interface MovementEntry {
  score: number | null;
  left: number | null;
  right: number | null;
  note: string;
}

export interface AssessmentData {
  /** The day of the assessment (yyyy-MM-dd). */
  takenAt: string;
  posture: Record<string, PostureEntry>;
  /** Anything not in the list: written once, then listed again next time. */
  others: OtherEntry[];
  movement: Record<string, MovementEntry>;
  tests: Partial<Record<TestId, number>> & { cardioName?: string; cardioResult?: string };
  /** Pain or discomfort. */
  pain: string;
  coachNotes: string;
  clientNotes: string;
}

export const emptyAssessment = (takenAt: string, carried: OtherEntry[] = []): AssessmentData => ({
  takenAt,
  posture: {},
  others: carried.map((o) => ({ id: o.id, name: o.name, rating: "", note: "" })),
  movement: {},
  tests: {},
  pain: "",
  coachNotes: "",
  clientNotes: "",
});

const txt = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
const rating = (v: unknown): Rating | "" => (v === "normal" || v === "mild" || v === "notable" ? v : "");
const score = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3 ? v : null);
const isoDay = (v: unknown, fallback: string): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? v : fallback);
const newId = () => `o_${Math.random().toString(36).slice(2, 10)}`;

/** Keeps only known, valid fields. Anything unknown or out of range is dropped, never trusted. */
export function cleanAssessment(raw: unknown, fallbackDay: string): AssessmentData {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out = emptyAssessment(isoDay(r.takenAt, fallbackDay));
  const posture = (r.posture && typeof r.posture === "object" ? r.posture : {}) as Record<string, Record<string, unknown>>;
  for (const p of POSTURE_ITEMS) {
    const e = posture[p.id];
    if (e && typeof e === "object" && (rating(e.rating) || txt(e.note, 400))) out.posture[p.id] = { rating: rating(e.rating), note: txt(e.note, 400) };
  }
  const others = Array.isArray(r.others) ? r.others : [];
  const seen = new Set<string>();
  for (const o of others.slice(0, 12)) {
    if (!o || typeof o !== "object") continue;
    const e = o as Record<string, unknown>;
    const name = txt(e.name, 60);
    if (!name) continue;
    let id = typeof e.id === "string" && /^[A-Za-z0-9_-]{3,40}$/.test(e.id) ? e.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    out.others.push({ id, name, rating: rating(e.rating), note: txt(e.note, 400) });
  }
  const movement = (r.movement && typeof r.movement === "object" ? r.movement : {}) as Record<string, Record<string, unknown>>;
  for (const m of MOVEMENT_ITEMS) {
    const e = movement[m.id];
    if (!e || typeof e !== "object") continue;
    const entry: MovementEntry = { score: score(e.score), left: score(e.left), right: score(e.right), note: txt(e.note, 400) };
    if (entry.score !== null || entry.left !== null || entry.right !== null || entry.note) out.movement[m.id] = entry;
  }
  const tests = (r.tests && typeof r.tests === "object" ? r.tests : {}) as Record<string, unknown>;
  for (const t of TEST_FIELDS) {
    const v = tests[t.id];
    if (typeof v === "number" && Number.isFinite(v) && v >= t.min && v <= t.max) out.tests[t.id] = Math.round(v * 10) / 10;
  }
  const cn = txt(tests.cardioName, 60);
  const cr = txt(tests.cardioResult, 60);
  if (cn) out.tests.cardioName = cn;
  if (cr) out.tests.cardioResult = cr;
  out.pain = txt(r.pain, 600);
  out.coachNotes = txt(r.coachNotes, 2000);
  out.clientNotes = txt(r.clientNotes, 2000);
  return out;
}

/** Has anything been filled in yet? (An empty assessment isn't worth saving as finished.) */
export function hasContent(d: AssessmentData): boolean {
  return Object.keys(d.posture).length > 0 || d.others.some((o) => o.rating || o.note) || Object.keys(d.movement).length > 0 || Object.keys(d.tests).length > 0 || !!d.pain || !!d.coachNotes || !!d.clientNotes;
}

/* ---------------- What to work on ---------------- */
export interface FocusArea {
  id: string;
  area: string;
  why: string;
  level: "high" | "medium";
  /** Names to look for in the exercise library (the first few that exist are suggested). */
  exercises: string[];
  /** Mobility and activation ideas that aren't library exercises. */
  cues: string[];
}

const worst = (...rs: (Rating | "" | undefined)[]): Rating | "" => (rs.includes("notable") ? "notable" : rs.includes("mild") ? "mild" : rs.includes("normal") ? "normal" : "");
const lvl = (r: Rating | ""): "high" | "medium" => (r === "notable" ? "high" : "medium");
const low = (s: number | null | undefined) => s !== null && s !== undefined && s <= 1;
const mid = (s: number | null | undefined) => s !== null && s !== undefined && s <= 2;

/** Turns the findings into a short, ordered list of what to work on besides building muscle. */
export function focusAreas(d: AssessmentData): FocusArea[] {
  const out: FocusArea[] = [];
  const p = (id: string) => d.posture[id]?.rating as Rating | "" | undefined;
  const add = (a: FocusArea) => out.push(a);

  const neck = worst(p("head_forward"), p("shoulders_rounded"), p("upper_back"));
  if (neck === "mild" || neck === "notable")
    add({ id: "upper_back", area: "Upper back and neck", why: "Head forward, rounded shoulders or a rounded upper back.", level: lvl(neck), exercises: ["Face Pull", "Band Pull Apart", "Seated Cable Row", "Chest Supported Row", "Superman"], cues: ["Chin tucks", "Chest and front-of-shoulder stretches", "Thoracic extension over a foam roller"] });
  const trunk = worst(p("lower_back"), p("pelvic_tilt"));
  if (trunk === "mild" || trunk === "notable")
    add({ id: "core_hips", area: "Core and hips", why: "Lower-back curve or pelvic tilt.", level: lvl(trunk), exercises: ["Dead Bug", "Bird Dog", "Glute Bridge", "Hip Thrust", "Plank"], cues: ["Hip flexor stretch", "Glute activation before lifting", "Breathing and ribcage position"] });
  const knees = worst(p("knee_align"), p("foot_arch"));
  if (knees === "mild" || knees === "notable")
    add({ id: "knees_feet", area: "Glutes, knees and feet", why: "Knees collapsing in or out, or flat arches.", level: lvl(knees), exercises: ["Glute Bridge", "Hip Thrust", "Lateral Band Walk", "Step Up", "Calf Raise"], cues: ["Banded glute work", "Short-foot drill", "Ankle mobility"] });
  const sym = worst(p("shoulder_height"), p("hip_level"));
  if (sym === "mild" || sym === "notable")
    add({ id: "balance_sides", area: "Left and right balance", why: "Uneven shoulders or hips.", level: lvl(sym), exercises: ["Single Arm Dumbbell Row", "Single Leg", "Farmer", "Bulgarian Split Squat"], cues: ["Train one side at a time", "Start with the weaker side"] });

  const m = d.movement;
  const sc = (id: string) => m[id];
  const sq = sc("overhead_squat");
  if (sq && mid(sq.score)) add({ id: "squat", area: "Squat pattern", why: low(sq.score) ? "Couldn't squat cleanly overhead." : "Squat needed compensation.", level: low(sq.score) ? "high" : "medium", exercises: ["Goblet Squat", "Box Squat", "Front Squat"], cues: ["Ankle and hip mobility", "Upper-back extension", "Counterbalance goblet squats"] });
  const bal = sc("single_leg_balance");
  if (bal && (mid(bal.left) || mid(bal.right))) add({ id: "balance", area: "Balance and stability", why: "Single-leg balance was weak" + (bal.left !== null && bal.right !== null && bal.left !== bal.right ? ` (left ${bal.left}, right ${bal.right}).` : "."), level: low(bal.left) || low(bal.right) ? "high" : "medium", exercises: ["Single Leg Romanian Deadlift", "Step Up", "Split Squat", "Single Leg"], cues: ["Barefoot balance holds", "Eyes-closed holds when ready"] });
  const hh = sc("hip_hinge");
  if (hh && mid(hh.score)) add({ id: "hinge", area: "Hip hinge", why: "Hip hinge needed compensation or couldn't be done.", level: low(hh.score) ? "high" : "medium", exercises: ["Romanian Deadlift", "Back Extension", "Hip Thrust", "Kettlebell Swing"], cues: ["Dowel along the spine drill", "Hamstring mobility"] });
  const sh = sc("shoulder_mobility");
  if (sh && (mid(sh.left) || mid(sh.right))) add({ id: "shoulder_mobility", area: "Shoulder mobility", why: "Reach behind the back was limited" + (sh.left !== null && sh.right !== null && sh.left !== sh.right ? ` (left ${sh.left}, right ${sh.right}).` : "."), level: low(sh.left) || low(sh.right) ? "high" : "medium", exercises: ["Face Pull", "Band Pull Apart", "Dumbbell External Rotation"], cues: ["Wall slides", "Doorway chest stretch", "Lat and chest mobility"] });
  const pu = sc("pushup");
  if (pu && mid(pu.score)) add({ id: "pushup", area: "Upper-body strength and trunk control", why: "Push-up form needed compensation or couldn't be done.", level: low(pu.score) ? "high" : "medium", exercises: ["Incline Push Up", "Push Up", "Plank"], cues: ["Incline push-ups first", "Shoulder-blade control"] });
  const pl = sc("plank");
  if (pl && mid(pl.score)) add({ id: "plank", area: "Core endurance", why: "Plank hold was short or sagged.", level: low(pl.score) ? "high" : "medium", exercises: ["Plank", "Dead Bug", "Bird Dog", "Pallof Press"], cues: ["Short, clean holds over long sloppy ones"] });

  for (const o of d.others) if (o.rating === "mild" || o.rating === "notable") add({ id: `other_${o.id}`, area: o.name, why: o.note || "Noted under Others.", level: lvl(o.rating), exercises: [], cues: [] });

  const t = d.tests;
  if ((t.bpSys !== undefined && t.bpSys >= 140) || (t.bpDia !== undefined && t.bpDia >= 90)) add({ id: "bp", area: "Blood pressure", why: `Reading ${t.bpSys ?? "?"}/${t.bpDia ?? "?"} is high. A doctor's check is recommended before hard training.`, level: "high", exercises: [], cues: ["Keep early sessions moderate", "Avoid breath-holding on heavy lifts"] });
  if (t.restingHr !== undefined && t.restingHr >= 100) add({ id: "hr", area: "Resting heart rate", why: `${t.restingHr} bpm at rest is high. Worth a doctor's check.`, level: "high", exercises: [], cues: ["Build cardio gently", "Recheck in a few weeks"] });
  if (d.pain) add({ id: "pain", area: "Pain or discomfort", why: d.pain, level: "high", exercises: [], cues: ["Train around it, not through it", "Refer on if it doesn't settle"] });

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));
}

/** A short block of facts (no names) used to ask the AI for a plain-English paragraph. */
export function factsFor(d: AssessmentData): string {
  const bits: string[] = [];
  for (const p of POSTURE_ITEMS) {
    const e = d.posture[p.id];
    if (e?.rating && e.rating !== "normal") bits.push(`${p.label}: ${e.rating}${e.note ? ` (${e.note})` : ""}`);
  }
  for (const o of d.others) if (o.rating && o.rating !== "normal") bits.push(`${o.name}: ${o.rating}${o.note ? ` (${o.note})` : ""}`);
  for (const m of MOVEMENT_ITEMS) {
    const e = d.movement[m.id];
    if (!e) continue;
    bits.push(`${m.label}: ${m.sided ? `left ${e.left ?? "-"}, right ${e.right ?? "-"}` : (e.score ?? "-")} of 3`);
  }
  if (d.pain) bits.push(`Pain: ${d.pain}`);
  return bits.join("; ").slice(0, 1100);
}

/* ---------------- Comparing over time ---------------- */
export interface CompareRow {
  key: string;
  label: string;
  group: "Posture" | "Others" | "Movement" | "Tests";
  /** One value per assessment, oldest first (null = not recorded). Text for ratings and scores. */
  values: (string | null)[];
  /** "better" | "worse" | "same" between the last two recorded values (when comparable). */
  trend: "better" | "worse" | "same" | null;
}

const RANK: Record<string, number> = { normal: 0, mild: 1, notable: 2 };

function trendOf(nums: (number | null)[], lowerIsBetter: boolean): CompareRow["trend"] {
  const got = nums.filter((n): n is number => n !== null);
  if (got.length < 2) return null;
  const a = got[got.length - 2], b = got[got.length - 1];
  if (a === b) return "same";
  return (b < a) === lowerIsBetter ? "better" : "worse";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Lines up assessments (oldest first). An "Other" item the coach wrote once is matched by its id, or by name, in every later assessment. */
export function compareAssessments(list: AssessmentData[]): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const p of POSTURE_ITEMS) {
    const vs = list.map((a) => a.posture[p.id]?.rating || null);
    if (vs.some(Boolean)) rows.push({ key: p.id, label: p.label, group: "Posture", values: vs.map((v) => (v ? RATING_LABEL[v as Rating] : null)), trend: trendOf(vs.map((v) => (v ? RANK[v] : null)), true) });
  }
  // Others, matched by id first and then by name.
  const seen: { key: string; label: string; ids: Set<string>; n: string }[] = [];
  for (const a of list)
    for (const o of a.others) {
      const hit = seen.find((s) => s.ids.has(o.id) || s.n === norm(o.name));
      if (hit) hit.ids.add(o.id);
      else seen.push({ key: o.id, label: o.name, ids: new Set([o.id]), n: norm(o.name) });
    }
  for (const s of seen) {
    const vs = list.map((a) => a.others.find((o) => s.ids.has(o.id) || norm(o.name) === s.n)?.rating || null);
    if (vs.some(Boolean)) rows.push({ key: s.key, label: s.label, group: "Others", values: vs.map((v) => (v ? RATING_LABEL[v as Rating] : null)), trend: trendOf(vs.map((v) => (v ? RANK[v] : null)), true) });
  }
  for (const m of MOVEMENT_ITEMS) {
    const vs = list.map((a) => {
      const e = a.movement[m.id];
      if (!e) return null;
      return m.sided ? (e.left === null && e.right === null ? null : `L ${e.left ?? "-"} · R ${e.right ?? "-"}`) : e.score === null ? null : String(e.score);
    });
    if (vs.some(Boolean)) {
      const nums = list.map((a) => {
        const e = a.movement[m.id];
        if (!e) return null;
        const xs = m.sided ? [e.left, e.right].filter((x): x is number => x !== null) : e.score === null ? [] : [e.score];
        return xs.length ? Math.min(...xs) : null;
      });
      rows.push({ key: m.id, label: m.label, group: "Movement", values: vs, trend: trendOf(nums, false) });
    }
  }
  // For these, higher is better (except resting heart rate, blood pressure, weight and body fat, which are only shown, not judged).
  const higher: TestId[] = ["pushups60", "plankSec", "sitReachCm"];
  for (const t of TEST_FIELDS) {
    const nums = list.map((a) => (a.tests[t.id] === undefined ? null : (a.tests[t.id] as number)));
    if (nums.some((n) => n !== null)) rows.push({ key: t.id, label: `${t.label} (${t.unit})`, group: "Tests", values: nums.map((n) => (n === null ? null : String(n))), trend: higher.includes(t.id) ? trendOf(nums, false) : null });
  }
  return rows;
}

export const VIEWS = ["front", "side", "back"] as const;
export type PhotoView = (typeof VIEWS)[number];
export const isView = (v: unknown): v is PhotoView => typeof v === "string" && (VIEWS as readonly string[]).includes(v);
