/*
 * The AI trainer for people training on their own: the safety rules, the exercise filter and a plain (no AI) plan builder.
 * Pure: no imports from the server, no database. The server asks the AI for a plan and checks it against THESE rules; if the AI is
 * busy or switched off, buildBasicPlan makes the plan. Nothing here is medical advice: it is a conservative filter for general fitness.
 *
 * Safety design (the owner chose "screening plus doctor check for risk"):
 *  - A health questionnaire first. Any "yes" means the plan is GENTLE and is only built once the person says a doctor has cleared them.
 *  - Gentle plans never contain barbell lifts, jumps, max-effort work or inversions, and keep sets and reps modest.
 *  - Conditions and injuries they mention (knee, back, shoulder, pregnancy...) remove the exercises that commonly aggravate them.
 *  - Coaches' monthly reviews add more "never give this to someone with X" rules (see aiReview.ts); those are applied here too.
 *  - "Something hurts" pauses the plan until they say it has been looked at.
 */
import { parqFlags, type GoalsData, type ParqData, type ParqId } from "@/lib/intakeForms";
import type { Exercise } from "@/lib/types";

export const NOT_MEDICAL_ADVICE = "The AI trainer gives general fitness suggestions. It is not medical advice and it does not replace a doctor or a coach. Stop and get help if something hurts or feels wrong.";

export const TRAINER_EQUIPMENT = ["BODYWEIGHT", "HOME", "GYM"] as const;
export type TrainerEquipment = (typeof TRAINER_EQUIPMENT)[number];
export const EQUIPMENT_LABEL: Record<TrainerEquipment, string> = {
  BODYWEIGHT: "Just my body, no equipment",
  HOME: "At home: dumbbells, bands, a mat",
  GYM: "A full gym",
};
const EQUIPMENT_OK: Record<TrainerEquipment, string[]> = {
  BODYWEIGHT: ["Bodyweight", "Yoga Mat"],
  HOME: ["Bodyweight", "Yoga Mat", "Dumbbell", "Resistance Band", "Kettlebell", "Foam Roller", "Jump Rope", "Medicine Ball"],
  GYM: ["Bodyweight", "Yoga Mat", "Dumbbell", "Resistance Band", "Kettlebell", "Barbell", "Machine", "Cable", "Smith Machine", "EZ-Bar", "Trap Bar", "Cardio Machine", "Foam Roller", "Medicine Ball"],
};

/* ---------------- The saved profile ---------------- */
export interface TrainerProfile {
  parq: ParqData;
  goals: GoalsData;
  equipment: TrainerEquipment;
  /** They said a doctor has cleared them to exercise (only asked when the questionnaire had a yes). */
  clearance: boolean;
  /** When they accepted "this is not medical advice". */
  acceptedAt: string;
}

/** Their state around the profile: paused after "something hurts", and how the plan has been nudged by how training went. */
export interface TrainerState {
  pausedAt: string | null;
  pauseNote: string;
  /** -1 a little less, 0 as planned, +1 a little more: set from what they logged. */
  volumeMod: number;
  weeksBuilt: number;
}

export const emptyState = (): TrainerState => ({ pausedAt: null, pauseNote: "", volumeMod: 0, weeksBuilt: 0 });

/* ---------------- Screening ---------------- */
export interface Screening {
  flags: ParqId[];
  /** Any yes: the plan is gentle. */
  gentle: boolean;
  /** Any yes: they must confirm a doctor has cleared them first. */
  needsClearance: boolean;
}

export function screen(parq: Pick<ParqData, "answers">): Screening {
  const flags = parqFlags(parq);
  return { flags, gentle: flags.length > 0, needsClearance: flags.length > 0 };
}

const KEYWORD_TAGS: [string, RegExp][] = [
  ["knee", /\bknees?\b|\bacl\b|\bmcl\b|meniscus|patell|kneecap/i],
  ["shoulder", /shoulder|rotator|collarbone|clavicle/i],
  ["back", /\bback\b|spine|spinal|\bdisc\b|sciatica|lumbar|scoliosis|slipped/i],
  ["hip", /\bhips?\b|groin|sacro/i],
  ["wrist", /wrist|carpal/i],
  ["ankle", /ankle|achilles|plantar/i],
  ["neck", /\bneck\b|cervical|whiplash/i],
];

/** The things we know about someone that decide what to keep out of their plan (heart, pregnant, knee...). Never shown with a name. */
export function profileTags(p: { parq: ParqData; goals: Pick<GoalsData, "pastInjuries" | "anythingElse" | "experience"> }): string[] {
  const tags = new Set<string>(parqFlags(p.parq));
  if ((p.goals.experience || "Beginner") === "Beginner") tags.add("beginner");
  const text = [...Object.values(p.parq.details ?? {}), p.parq.other ?? "", p.goals.pastInjuries ?? "", p.goals.anythingElse ?? ""].join(" ");
  for (const [tag, re] of KEYWORD_TAGS) if (re.test(text)) tags.add(tag);
  return [...tags].sort();
}

/* ---------------- What to keep out ---------------- */
export interface CoachRule {
  /** Applies to anyone with one of these tags ("any" applies to everybody). */
  tags: string[];
  /** Exercises a reviewing coach said not to give them. */
  exerciseIds: string[];
  /** The coach's words, passed to the AI as an instruction. */
  text: string;
}

export interface FilterContext {
  equipment: TrainerEquipment;
  gentle: boolean;
  tags: string[];
  rules: CoachRule[];
}

const IMPACT = /jump|plyo|burpee|sprint|bounce|\bhop\b|skip|box jump|ballistic|kipping|high knees|mountain climber|\brun\b|running|thruster|man ?maker|swing|slam|wall ball|turkish|battle rope/i;
const OLYMPIC = /clean|snatch|jerk|muscle up|complex/i;
/** Single-leg and split-stance work that needs good balance: left out of gentle plans. */
const BALANCE = /single leg (?:romanian|squat|deadlift|hip thrust|calf)|single-leg|bulgarian|split squat|pistol|skater|curtsy|cossack/i;
const INVERTED = /handstand|headstand|inverted|\bpike\b|decline/i;
const HEAVY_EQUIPMENT = ["Barbell", "Trap Bar", "Smith Machine", "EZ-Bar"];
const ADVANCED = /weighted|archer|muscle up|pistol|handstand|dragon|nordic|one arm|deficit|snatch|clean|jerk|toes to bar|windshield|sissy|ring |explosive|plyo|kroc|chest dip|decline push|pike push|single leg hip thrust|man ?maker|dragon flag|l-sit|planche|complex/i;

const TAG_AVOID: Record<string, RegExp> = {
  heart: /\bhang\b|dead hang|isometric|wall sit|plank/i,
  meds: /dead hang|isometric|wall sit|hollow hold|plank/i,
  chest: /\bhang\b|dead hang|isometric|wall sit/i,
  dizzy: /handstand|headstand|inverted|\bpike\b|decline|\bspin|jump|balance|pistol|single leg/i,
  joints: /pistol|sissy|nordic|deep|overhead|behind the neck|upright row/i,
  recent: /pistol|sissy|nordic|overhead|behind the neck|upright row/i,
  pregnant: /lying|supine|crunch|sit up|sit-up|v-up|hollow|leg raise|dead bug|bench press|pullover|plank|mountain|hanging|flat|decline|skull|russian twist|oblique|bicycle|windshield|superman|prone|back extension|hip thrust|glute bridge|frog pump|chest fly|dumbbell fly|\bfly\b|dumbbell press|bench|glute ham|ghr|thruster/i,
  knee: /jump|lunge|pistol|sissy|squat|leg extension|leg press|step up|step-up|wall sit|nordic|hack|bounce|box|sled|stair|thruster|wall ball|burpee|sumo|crawl/i,
  shoulder: /overhead|shoulder press|military|handstand|pike|upright|behind the neck|dip|push press|snatch|jerk|arnold|pullover|dumbbell fly|chest fly|\bfly\b|hang|pull up|chin up|muscle up|thruster|turkish|clean and press|kettlebell press|man ?maker|landmine|complex/i,
  back: /deadlift|good morning|bent over|barbell row|hyperextension|back extension|superman|sit up|sit-up|crunch|v-up|twist|rack pull|clean|snatch|barbell squat|jefferson|toes to bar|hanging leg|windshield|dragon|\bwood chop|swing|thruster|burpee|dumbbell snatch|kroc|man ?maker|complex/i,
  hip: /sumo|lunge|pistol|split squat|hip abduction|hip adduction|bulgarian|cossack|deep/i,
  wrist: /push up|push-up|handstand|pike|plank|dip|bear crawl|mountain|front squat|clean|snatch|farmer|barbell curl|wrist/i,
  ankle: /jump|calf|skip|rope|lunge|pistol|bounce|box|sprint|hop|step up|stair|sled/i,
  neck: /shrug|upright|behind the neck|handstand|bridge|neck|headstand|pike/i,
};

/** Why an exercise is not suitable for this person, or null if it is fine. (Used for plans and for the reviewing coaches' notes.) */
export function hazardFor(ex: Pick<Exercise, "id" | "name" | "primary" | "equipment">, ctx: Pick<FilterContext, "gentle" | "tags" | "rules">): string | null {
  const name = ex.name;
  if (ctx.gentle) {
    if (IMPACT.test(name)) return "high-impact or jumping";
    if (OLYMPIC.test(name)) return "explosive lifting";
    if (INVERTED.test(name)) return "upside-down or head-down position";
    if (HEAVY_EQUIPMENT.includes(ex.equipment)) return "heavy barbell or bar lifts need supervision";
    if (ADVANCED.test(name)) return "advanced move";
    if (BALANCE.test(name)) return "balance-heavy single-leg work";
  }
  // A beginner is not given advanced moves, whether or not the plan is gentle.
  if (!ctx.gentle && ctx.tags.includes("beginner") && ADVANCED.test(name)) return "too advanced for a beginner";
  for (const tag of ctx.tags) {
    const re = TAG_AVOID[tag];
    if (re && re.test(name)) return `not usually suitable with ${tag === "joints" ? "a joint problem" : tag}`;
    if (tag === "pregnant" && ex.primary === "Abdominals") return "abdominal work is usually avoided in pregnancy";
  }
  for (const r of ctx.rules) {
    if ((r.tags.includes("any") || r.tags.some((t) => ctx.tags.includes(t))) && r.exerciseIds.includes(ex.id)) return "a reviewing coach said not to give this";
  }
  return null;
}

/** The only cardio the trainer uses: easy, steady work. Machines only in a gym; walking and running outdoors anywhere. */
const CARDIO_ANYWHERE = ["Outdoor Walk", "Outdoor Run"];
const CARDIO_GYM = ["Treadmill Walk", "Treadmill Incline Walk", "Treadmill Run", "Stationary Bike", "Spin Bike", "Recumbent Bike", "Elliptical Trainer", "Rowing Machine (Concept2)", "Stair Climber"];

/** The exercises this person may be given: from the right equipment, with everything unsuitable taken out. */
export function allowedLibrary(library: Exercise[], ctx: FilterContext): Exercise[] {
  const ok = new Set(EQUIPMENT_OK[ctx.equipment]);
  return library.filter((e) => {
    const strength = (e.discipline ?? "Strength & Gym") === "Strength & Gym" && ok.has(e.equipment);
    const cardio = e.primary === "Cardio" && (CARDIO_ANYWHERE.includes(e.name) || (ctx.equipment === "GYM" && CARDIO_GYM.includes(e.name)));
    return (strength || cardio) && hazardFor(e, ctx) === null;
  });
}

/* ---------------- Plans ---------------- */
export interface PlanExercise {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  durationSec?: number;
  note?: string;
}
export interface PlanDay {
  name: string;
  focus: string;
  /** The weekday the person said they train, e.g. "Mon". */
  suggestedDay?: string;
  exercises: PlanExercise[];
}
export interface TrainerPlan {
  /** The Monday (yyyy-MM-dd, Singapore time) of the week this plan is for. */
  weekStart: string;
  summary: string;
  source: "ai" | "basic";
  gentle: boolean;
  days: PlanDay[];
}

/** Monday of the week containing `now`, in Singapore time. */
export function weekStartOf(now = new Date()): string {
  const sg = new Date(now.getTime() + 8 * 3_600_000);
  const day = (sg.getUTCDay() + 6) % 7;
  sg.setUTCDate(sg.getUTCDate() - day);
  return sg.toISOString().slice(0, 10);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const isTimed = (e: Pick<Exercise, "type">) => e.type === "DURATION_ONLY" || e.type === "DURATION_DISTANCE";

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Slot = Exercise["primary"][] | Exercise["primary"];
const FULL_A: Slot[] = [["Quadriceps"], ["Chest"], ["Lats", "Upper Back"], ["Hamstrings", "Glutes"], ["Front Delts", "Side Delts"], ["Abdominals"]];
const FULL_B: Slot[] = [["Glutes", "Hamstrings"], ["Upper Back", "Lats"], ["Chest"], ["Quadriceps"], ["Triceps", "Biceps"], ["Abdominals", "Lower Back"]];
const FULL_C: Slot[] = [["Quadriceps", "Glutes"], ["Lats"], ["Chest", "Front Delts"], ["Hamstrings"], ["Rear Delts", "Side Delts"], ["Abdominals"]];
const UPPER: Slot[] = [["Chest"], ["Lats"], ["Upper Back"], ["Front Delts", "Side Delts"], ["Biceps"], ["Triceps"]];
const LOWER: Slot[] = [["Quadriceps"], ["Hamstrings"], ["Glutes"], ["Calves"], ["Abdominals"], ["Lower Back", "Obliques"]];
const PUSH: Slot[] = [["Chest"], ["Front Delts"], ["Chest"], ["Side Delts"], ["Triceps"], ["Triceps"]];
const PULL: Slot[] = [["Lats"], ["Upper Back"], ["Lats", "Upper Back"], ["Rear Delts"], ["Biceps"], ["Biceps", "Forearms"]];
const LEGS: Slot[] = [["Quadriceps"], ["Hamstrings"], ["Glutes"], ["Quadriceps", "Glutes"], ["Calves"], ["Abdominals"]];

interface DayShape {
  name: string;
  focus: string;
  slots: Slot[];
}
function shapesFor(n: number): DayShape[] {
  const A = { name: "Full body A", focus: "Whole body", slots: FULL_A };
  const B = { name: "Full body B", focus: "Whole body", slots: FULL_B };
  const C = { name: "Full body C", focus: "Whole body", slots: FULL_C };
  const U = { name: "Upper body", focus: "Chest, back, shoulders and arms", slots: UPPER };
  const L = { name: "Lower body", focus: "Legs and core", slots: LOWER };
  const P = { name: "Push", focus: "Chest, shoulders and triceps", slots: PUSH };
  const Q = { name: "Pull", focus: "Back and biceps", slots: PULL };
  const G = { name: "Legs", focus: "Legs and core", slots: LEGS };
  if (n <= 2) return [A, B];
  if (n === 3) return [A, B, C];
  if (n === 4) return [U, L, { ...U, name: "Upper body 2" }, { ...L, name: "Lower body 2" }];
  if (n === 5) return [P, Q, G, U, L];
  return [P, Q, G, { ...P, name: "Push 2" }, { ...Q, name: "Pull 2" }, { ...G, name: "Legs 2" }];
}

export interface Scheme {
  sets: number;
  repMin: number;
  repMax: number;
}
/** Sets and reps from the goal, experience, how gentle the plan is and how last week went. */
export function schemeFor(goals: Pick<GoalsData, "goalCategory" | "experience">, gentle: boolean, volumeMod: number): Scheme {
  const exp = goals.experience || "Beginner";
  let sets = exp === "Advanced" ? 4 : exp === "Intermediate" ? 3 : 2;
  let repMin = 10;
  let repMax = 12;
  switch (goals.goalCategory) {
    case "Strength":
      [repMin, repMax] = exp === "Beginner" ? [6, 10] : [5, 8];
      break;
    case "Hypertrophy":
      [repMin, repMax] = [8, 12];
      break;
    case "Fat Loss":
      [repMin, repMax] = [12, 15];
      break;
    case "Conditioning":
      [repMin, repMax] = [15, 20];
      break;
    default:
      break;
  }
  sets += Math.max(-1, Math.min(1, volumeMod));
  if (gentle) {
    sets = Math.min(sets, 3);
    repMin = Math.max(repMin, 10);
    repMax = Math.max(repMax, 15);
  }
  return { sets: Math.max(2, Math.min(5, sets)), repMin, repMax: Math.max(repMin, repMax) };
}

/** Spreads n workouts over the days they said they can train. */
export function assignDays(wanted: string[], n: number): (string | undefined)[] {
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const pool = order.filter((d) => wanted.includes(d));
  if (pool.length >= n) return Array.from({ length: n }, (_, i) => pool[Math.floor((i * pool.length) / n)]);
  const fallback = n === 2 ? ["Mon", "Thu"] : n === 3 ? ["Mon", "Wed", "Fri"] : n === 4 ? ["Mon", "Tue", "Thu", "Fri"] : n === 5 ? ["Mon", "Tue", "Wed", "Fri", "Sat"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return pool.length > 0 ? [...pool, ...fallback.filter((d) => !pool.includes(d))].slice(0, n) : fallback.slice(0, n);
}

export function sessionsPerWeek(goals: Pick<GoalsData, "sessionsPerWeek">): number {
  const n = Math.round(Number(goals.sessionsPerWeek) || 3);
  return Math.max(2, Math.min(6, n));
}

export interface BuildInput {
  /** Already filtered with allowedLibrary. */
  library: Exercise[];
  goals: GoalsData;
  gentle: boolean;
  volumeMod: number;
  weekStart: string;
  /** Changes the choice of exercises from one person or week to the next. */
  seed: string;
}

/** A sensible plan from the exercise library alone (no AI): used when the AI is busy or off, and for the coaches' review samples. */
export function buildBasicPlan(input: BuildInput): TrainerPlan {
  const { library, goals, gentle } = input;
  const n = sessionsPerWeek(goals);
  const scheme = schemeFor(goals, gentle, input.volumeMod);
  const random = rng(hashSeed(input.seed + input.weekStart));
  const beginner = (goals.experience || "Beginner") === "Beginner";
  const weekDays = assignDays(goals.days ?? [], n);
  const rank = (e: Exercise) => {
    let s = 0;
    if (ADVANCED.test(e.name)) s += beginner ? 4 : 1;
    if (e.equipment === "Machine" || e.equipment === "Dumbbell") s -= beginner ? 1 : 0;
    if (isTimed(e)) s += 1;
    return s;
  };
  const days: PlanDay[] = shapesFor(n).map((shape, i) => {
    const used = new Set<string>();
    const exercises: PlanExercise[] = [];
    for (const slot of shape.slots) {
      const muscles = Array.isArray(slot) ? slot : [slot];
      const pool = library.filter((e) => muscles.includes(e.primary) && !used.has(e.id) && !isTimed(e)).sort((a, b) => rank(a) - rank(b));
      const top = pool.slice(0, Math.max(3, Math.min(8, pool.length)));
      const pick = top.length ? top[Math.floor(random() * top.length)] : undefined;
      if (!pick) continue;
      used.add(pick.id);
      exercises.push({ exerciseId: pick.id, sets: scheme.sets, repMin: scheme.repMin, repMax: scheme.repMax });
    }
    if (goals.goalCategory === "Fat Loss" || goals.goalCategory === "Conditioning") {
      const cardio = library.filter((e) => e.primary === "Cardio" && !used.has(e.id) && isTimed(e));
      const c = cardio.length ? cardio[Math.floor(random() * cardio.length)] : undefined;
      if (c) exercises.push({ exerciseId: c.id, sets: 1, repMin: 0, repMax: 0, durationSec: gentle ? 600 : 900 });
    }
    return { name: `Day ${i + 1}: ${shape.name}`, focus: shape.focus, suggestedDay: weekDays[i], exercises };
  });
  const usable = days.filter((d) => d.exercises.length >= 3);
  return {
    weekStart: input.weekStart,
    summary: summaryLine(usable.length, gentle, goals.goalCategory),
    source: "basic",
    gentle,
    days: usable,
  };
}

export function summaryLine(n: number, gentle: boolean, goal: string): string {
  const g = goal ? ` aimed at ${goal.toLowerCase()}` : "";
  return `${n} workout${n === 1 ? "" : "s"} this week${g}.${gentle ? " It is a gentle plan: lighter, no jumping or heavy bar lifts, because of your health answers." : ""}`;
}

/* ---------------- Checking what the AI returned ---------------- */
/**
 * Turns the AI's JSON into a plan we trust: only exercises from the allowed list (matched by name), sensible sets and reps for this
 * person, 4 to 8 exercises a day. Anything else is dropped. Returns null when nothing usable is left.
 */
export function sanitizePlan(raw: unknown, allowed: Exercise[], opts: { gentle: boolean; weekStart: string; days: string[]; sessions: number }): TrainerPlan | null {
  const root = raw as { days?: unknown; summary?: unknown };
  if (!root || !Array.isArray(root.days)) return null;
  const byName = new Map(allowed.map((e) => [norm(e.name), e]));
  const maxSets = opts.gentle ? 3 : 5;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  const out: PlanDay[] = [];
  for (const item of root.days.slice(0, 7)) {
    if (!item || typeof item !== "object") continue;
    const d = item as { name?: unknown; focus?: unknown; exercises?: unknown };
    if (!Array.isArray(d.exercises)) continue;
    const seen = new Set<string>();
    const exercises: PlanExercise[] = [];
    for (const e of d.exercises.slice(0, 10)) {
      if (!e || typeof e !== "object") continue;
      const x = e as Record<string, unknown>;
      const lib = typeof x.name === "string" ? byName.get(norm(x.name)) : undefined;
      if (!lib || seen.has(lib.id)) continue;
      seen.add(lib.id);
      if (isTimed(lib)) {
        exercises.push({ exerciseId: lib.id, sets: 1, repMin: 0, repMax: 0, durationSec: num(x.durationSec, 60, opts.gentle ? 1200 : 2400, 600) });
        continue;
      }
      let repMin = num(x.repMin, 3, 30, 10);
      let repMax = Math.max(repMin, num(x.repMax, 3, 30, repMin + 2));
      // The AI sometimes gives core work or a range like 3-3: core moves get a normal 10-15 and a range always has some room.
      if ((lib.primary === "Abdominals" || lib.primary === "Obliques") && repMax < 10) [repMin, repMax] = [10, 15];
      else if (repMax === repMin && repMin < 8) repMax = repMin + 2;
      const note = typeof x.note === "string" ? x.note.replace(/\s+/g, " ").trim().slice(0, 140) : "";
      exercises.push({
        exerciseId: lib.id,
        sets: num(x.sets, 1, maxSets, 3),
        repMin: opts.gentle ? Math.max(repMin, 10) : repMin,
        repMax: opts.gentle ? Math.max(repMax, 15) : repMax,
        ...(note ? { note } : {}),
      });
    }
    if (exercises.length < 4) continue;
    const name = typeof d.name === "string" && d.name.trim() ? d.name.replace(/\s+/g, " ").trim().slice(0, 50) : `Day ${out.length + 1}`;
    const focus = typeof d.focus === "string" ? d.focus.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    out.push({ name, focus, exercises: exercises.slice(0, 8) });
  }
  if (out.length === 0) return null;
  const days = out.slice(0, opts.sessions);
  const suggested = assignDays(opts.days, days.length);
  days.forEach((d, i) => (d.suggestedDay = suggested[i]));
  const summary = typeof root.summary === "string" && root.summary.trim() ? root.summary.replace(/\s+/g, " ").trim().slice(0, 240) : summaryLine(days.length, opts.gentle, "");
  return { weekStart: opts.weekStart, summary, source: "ai", gentle: opts.gentle, days };
}

/* ---------------- Letting last week change this week ---------------- */
/** completion 0-1 (finished / planned), pain 0-10 (average from how workouts felt), or null when unknown. */
export function nextVolumeMod(prev: number, completion: number | null, pain: number | null): number {
  if (completion === null) return prev;
  if ((pain ?? 0) >= 6 || completion < 0.5) return Math.max(-1, prev - 1);
  if (completion >= 0.8 && (pain ?? 0) <= 3) return Math.min(1, prev + 1);
  return prev;
}

/** Words in a "this hurts" note that mean they should see someone, not train. */
export const URGENT_WORDS = /chest|heart|faint|dizz|breath|numb|tingl|swell|can't (?:move|walk|lift)|sharp|severe|blood/i;
export const PAUSE_ADVICE = "Your plan is paused. If it is sharp, getting worse, or comes with chest pain, dizziness, numbness or trouble breathing, stop and see a doctor. Once it has been looked at, you can restart.";
