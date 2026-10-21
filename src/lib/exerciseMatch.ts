import type { Equipment, Exercise, MeasureType, MuscleGroup } from "./types";

/*
 * Fuzzy matching of free-text exercise names ("db bench", "Lat pull down", "Incline dumbell press") against the
 * exercise library. Tokens are normalised (abbreviations, plurals, compound words), equipment words count for less than
 * movement words, and near-miss spellings still match.
 */

const ABBREV: Record<string, string> = {
  db: "dumbbell",
  dbs: "dumbbell",
  dumbell: "dumbbell",
  dumbells: "dumbbell",
  bb: "barbell",
  barbel: "barbell",
  kb: "kettlebell",
  kettlebel: "kettlebell",
  bw: "bodyweight",
  ohp: "overhead press",
  rdl: "romanian deadlift",
  sldl: "stiff leg deadlift",
  ez: "ez",
  pushup: "push up",
  pushups: "push up",
  pullup: "pull up",
  pullups: "pull up",
  chinup: "chin up",
  chinups: "chin up",
  situp: "sit up",
  situps: "sit up",
  stepup: "step up",
  stepups: "step up",
  pulldown: "pull down",
  pulldowns: "pull down",
  pushdown: "push down",
  pushdowns: "push down",
  tri: "tricep",
  bi: "bicep",
  quads: "quadricep",
  hams: "hamstring",
  glute: "glute",
  abs: "abdominal",
  ab: "abdominal",
  lats: "lat",
};

/** Equipment words say *how* an exercise is done, so they count for less than the movement words. */
const EQUIPMENT_WORDS = new Set(["barbell", "dumbbell", "cable", "machine", "smith", "kettlebell", "band", "resistance", "bodyweight", "ez", "trap", "hex"]);
const FILLER = new Set(["the", "a", "an", "with", "on", "of", "using", "version"]);

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("sses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

export function tokens(name: string): string[] {
  const base = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const raw of base) {
    const expanded = ABBREV[raw] ?? raw;
    for (const w of expanded.split(" ")) {
      if (!w || FILLER.has(w)) continue;
      out.push(stem(w));
    }
  }
  // "Back squat" is just a squat in the library.
  return out.includes("squat") ? out.filter((w) => w !== "back") : out;
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const tokenEq = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1) || (a.length >= 8 && b.length >= 8 && lev(a, b) <= 2);
const weight = (t: string) => (EQUIPMENT_WORDS.has(t) ? 0.35 : 1);

export interface Candidate {
  id: string;
  score: number;
}

export type MatchStatus = "matched" | "check" | "none";

export interface MatchResult {
  best: Candidate | null;
  status: MatchStatus;
  suggestions: Candidate[];
}

export interface MatchIndex {
  entries: { id: string; name: string; toks: string[]; total: number; squashed: string }[];
}

export function buildIndex(exercises: Exercise[]): MatchIndex {
  return {
    entries: exercises.map((e) => {
      const toks = tokens(e.name);
      return { id: e.id, name: e.name, toks, total: toks.reduce((n, t) => n + weight(t), 0), squashed: toks.join("") };
    }),
  };
}

function score(userToks: string[], userSquashed: string, entry: MatchIndex["entries"][number]): number {
  if (!userToks.length) return 0;
  const userTotal = userToks.reduce((n, t) => n + weight(t), 0);
  const used = new Set<number>();
  let inter = 0;
  for (const t of userToks) {
    const k = entry.toks.findIndex((x, i) => !used.has(i) && tokenEq(t, x));
    if (k >= 0) {
      used.add(k);
      inter += Math.min(weight(t), weight(entry.toks[k]));
    }
  }
  const dice = (2 * inter) / (userTotal + entry.total);
  // "benchpress" / "pull down" style spellings: compare with the spaces removed.
  const longer = Math.max(userSquashed.length, entry.squashed.length);
  const sim = longer ? 1 - lev(userSquashed, entry.squashed) / longer : 0;
  return Math.max(dice, sim >= 0.8 ? sim * 0.96 : 0);
}

export function matchExercise(name: string, index: MatchIndex): MatchResult {
  const userToks = tokens(name);
  const squashed = userToks.join("");
  const scored = index.entries
    .map((e) => ({ id: e.id, score: score(userToks, squashed, e) }))
    .filter((c) => c.score >= 0.4)
    .sort((a, b) => b.score - a.score);
  const best = scored[0] ?? null;
  const status: MatchStatus = !best || best.score < 0.65 ? "none" : best.score >= 0.84 ? "matched" : "check";
  return { best: status === "none" ? null : best, status, suggestions: scored.slice(0, 6) };
}

/** True when the line is (nearly) an exact library name, used to tell "Squat" apart from a heading. */
export function isKnownName(name: string, index: MatchIndex): boolean {
  const r = matchExercise(name, index);
  return r.status === "matched";
}

/* ---------------- Sensible defaults for a brand-new custom exercise ---------------- */
export interface ExerciseGuess {
  name: string;
  primary: MuscleGroup;
  equipment: Equipment;
  type: MeasureType;
}

const MUSCLE_HINTS: [RegExp, MuscleGroup][] = [
  [/\b(bench|chest|fly|flye|pec|push[- ]?up|dip)\b/i, "Chest"],
  [/\b(row|pull[- ]?up|chin|lat|pulldown|pull down)\b/i, "Lats"],
  [/\b(squat|leg press|lunge|quad|leg extension|step[- ]?up)\b/i, "Quadriceps"],
  [/\b(deadlift|hamstring|leg curl|rdl|good morning)\b/i, "Hamstrings"],
  [/\b(glute|hip thrust|bridge|kickback)\b/i, "Glutes"],
  [/\b(calf|calves)\b/i, "Calves"],
  [/\b(shoulder|overhead|ohp|military)\b/i, "Front Delts"],
  [/\b(lateral raise|side raise)\b/i, "Side Delts"],
  [/\b(rear delt|face pull|reverse fly)\b/i, "Rear Delts"],
  [/\b(curl|bicep)\b/i, "Biceps"],
  [/\b(tricep|pushdown|skull|extension)\b/i, "Triceps"],
  [/\b(crunch|plank|sit[- ]?up|ab|core|leg raise)\b/i, "Abdominals"],
  [/\b(shrug|trap)\b/i, "Traps"],
  [/\b(run|walk|bike|cycle|row(?:ing)? machine|treadmill|elliptical|swim|jog|cardio|stair|ski)\b/i, "Cardio"],
];

export function guessExercise(name: string, timed: boolean, hasDistance: boolean, hasWeight: boolean): ExerciseGuess {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 100);
  const primary = MUSCLE_HINTS.find(([re]) => re.test(clean))?.[1] ?? (timed ? "Cardio" : "Full Body");
  const equipment: Equipment = /\bbarbell|\bbb\b/i.test(clean)
    ? "Barbell"
    : /\bdumbbell|\bdb\b/i.test(clean)
      ? "Dumbbell"
      : /\bcable\b/i.test(clean)
        ? "Cable"
        : /\bkettlebell|\bkb\b/i.test(clean)
          ? "Kettlebell"
          : /\bmachine\b/i.test(clean)
            ? "Machine"
            : /\bband\b/i.test(clean)
              ? "Resistance Band"
              : /\btreadmill|bike|elliptical|rower|stairmaster\b/i.test(clean)
                ? "Cardio Machine"
                : hasWeight
                  ? "Other"
                  : "Bodyweight";
  const type: MeasureType = timed ? (hasDistance || primary === "Cardio" ? "DURATION_DISTANCE" : "DURATION_ONLY") : hasWeight ? "WEIGHT_REPS" : "BODYWEIGHT_REPS";
  return { name: clean, primary, equipment, type };
}
