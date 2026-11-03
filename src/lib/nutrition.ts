/*
 * Food diary rules shared by the screens, the server and the tests. Everything here is pure.
 * Nutrition numbers are estimates: AI-estimated entries are always marked "approx".
 */

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export const MEALS: { id: MealType; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snacks" },
];

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type FoodSource = "AI_PHOTO" | "AI_TEXT" | "SEARCH" | "BARCODE" | "COMMON" | "MANUAL" | "RECENT";
export const FOOD_SOURCES: FoodSource[] = ["AI_PHOTO", "AI_TEXT", "SEARCH", "BARCODE", "COMMON", "MANUAL", "RECENT"];
export type Confidence = "high" | "medium" | "low";

export interface FoodEntry extends Macros {
  id: string;
  /** yyyy-MM-dd on the person's own calendar. */
  day: string;
  meal: MealType;
  loggedAt: string;
  name: string;
  brand?: string;
  /** What was eaten, in words ("1 bowl (about 300 g)", "150 g"). */
  amountText: string;
  grams?: number;
  /** Per 100 g, when known: the amount can then be changed and the numbers follow. */
  per100?: Macros;
  source: FoodSource;
  /** An estimate rather than a measured or printed value. Shown as "approx." */
  approx: boolean;
  confidence?: Confidence;
  /** Allergen / diet tags this food probably contains (see FOOD_TAGS). */
  contains?: string[];
}

export interface NutritionTargets extends Macros {
  setBy: "COACH" | "CLIENT";
  at: string;
}

export interface DietaryProfile {
  /** null until the person has said. Under 18s keep the diary but get no calorie targets. */
  adult: boolean | null;
  diets: string[];
  allergies: string[];
  other: string;
}

export interface FoodComment {
  id: string;
  day: string;
  authorId: string;
  authorName: string;
  text: string;
  at: string;
}

/* ---------------- Diets, allergies and what foods contain ---------------- */
export const FOOD_TAGS = ["pork", "beef", "meat", "fish", "shellfish", "egg", "dairy", "gluten", "peanut", "tree_nut", "soy", "sesame", "alcohol"] as const;
export type FoodTag = (typeof FOOD_TAGS)[number];
const TAG_LABEL: Record<FoodTag, string> = { pork: "pork", beef: "beef", meat: "meat", fish: "fish", shellfish: "shellfish", egg: "egg", dairy: "dairy", gluten: "gluten", peanut: "peanuts", tree_nut: "tree nuts", soy: "soy", sesame: "sesame", alcohol: "alcohol" };
export const tagLabel = (t: string) => TAG_LABEL[t as FoodTag] ?? t;

/** What each diet rules out (a food with any of these tags conflicts). */
export const DIETS: Record<string, FoodTag[]> = {
  Vegetarian: ["meat", "pork", "beef", "fish", "shellfish"],
  Vegan: ["meat", "pork", "beef", "fish", "shellfish", "egg", "dairy"],
  Pescatarian: ["meat", "pork", "beef"],
  Halal: ["pork", "alcohol"],
  "No pork": ["pork"],
  "No beef": ["beef"],
  "Gluten-free": ["gluten"],
  "Dairy-free": ["dairy"],
};
export const ALLERGIES: Record<string, FoodTag[]> = {
  Peanuts: ["peanut"],
  "Tree nuts": ["tree_nut"],
  "Milk / dairy": ["dairy"],
  Eggs: ["egg"],
  "Wheat / gluten": ["gluten"],
  Soy: ["soy"],
  Fish: ["fish"],
  Shellfish: ["shellfish"],
  Sesame: ["sesame"],
};

export const isFoodTag = (t: unknown): t is FoodTag => typeof t === "string" && (FOOD_TAGS as readonly string[]).includes(t);

/** Warnings for a food against someone's diets and allergies. Allergies are worded as a risk ("may contain"), diets as a fact. */
export function dietConflicts(profile: Pick<DietaryProfile, "diets" | "allergies">, contains: readonly string[] | undefined): string[] {
  const have = new Set(contains ?? []);
  if (have.size === 0) return [];
  const out: string[] = [];
  for (const a of profile.allergies) {
    const hit = (ALLERGIES[a] ?? []).filter((t) => have.has(t));
    if (hit.length) out.push(`May contain ${tagLabel(hit[0])}. You listed ${a.toLowerCase()} as an allergy.`);
  }
  for (const d of profile.diets) {
    const hit = (DIETS[d] ?? []).filter((t) => have.has(t));
    if (hit.length) out.push(`Contains ${tagLabel(hit[0])}, which doesn’t fit ${d.toLowerCase() === "halal" ? "halal" : d}.`);
  }
  return out;
}

/* ---------------- Shapes shared with the lookups (AI estimates, packaged foods) ---------------- */
export interface EstimatedItem {
  name: string;
  amountText: string;
  grams?: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: Confidence;
  contains: FoodTag[];
}
export interface Estimate {
  items: EstimatedItem[];
  note: string;
}

export interface PackagedFood {
  code?: string;
  name: string;
  brand?: string;
  per100: Macros;
  servingGrams?: number;
  servingLabel?: string;
  contains: FoodTag[];
}

/** A food waiting to be saved: everything an entry has except where and when it goes. */
export type Candidate = Omit<FoodEntry, "id" | "day" | "meal" | "loggedAt"> & { key: string };

/* ---------------- Numbers ---------------- */
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r0 = (n: number) => Math.round(n);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function sumMacros(list: readonly Macros[]): Macros {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const m of list) {
    t.kcal += m.kcal;
    t.protein += m.protein;
    t.carbs += m.carbs;
    t.fat += m.fat;
  }
  return { kcal: r0(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) };
}

/** Calories implied by the macros (4 kcal per g of protein and carbs, 9 per g of fat). */
export const atwater = (m: Pick<Macros, "protein" | "carbs" | "fat">) => 4 * m.protein + 4 * m.carbs + 9 * m.fat;

/**
 * AI answers sometimes disagree with themselves (calories that don't match the macros). When they are far apart the macros win,
 * because they are the more careful part of an estimate. Alcohol is left alone: it has calories (7 per g) that the macros don't show.
 * Returns whether anything was changed.
 */
export function reconcileKcal(m: Macros, opts: { alcohol?: boolean } = {}): { macros: Macros; adjusted: boolean } {
  if (opts.alcohol) return { macros: m, adjusted: false };
  const a = atwater(m);
  if (a < 40) return { macros: m, adjusted: false };
  if (m.kcal <= 0 || Math.abs(m.kcal - a) / Math.max(m.kcal, a) > 0.3) return { macros: { ...m, kcal: r0(a) }, adjusted: m.kcal > 0 };
  return { macros: m, adjusted: false };
}

/** The same food at a different amount in grams (needs per-100 g values). */
export function atGrams(per100: Macros, grams: number): Macros {
  const f = grams / 100;
  return { kcal: r0(per100.kcal * f), protein: r1(per100.protein * f), carbs: r1(per100.carbs * f), fat: r1(per100.fat * f) };
}

/** What the amount says after scaling: a plain gram figure stays in grams; a portion ("1 plate") gets a "0.5x" in front. */
function scaledAmountText(e: Pick<FoodEntry, "amountText" | "grams" | "per100">, factor: number): string {
  if (e.grams && (e.per100 || /^\d+(\.\d+)? g$/.test(e.amountText))) return `${r0(e.grams * factor)} g`;
  const m = /^(\d+(?:\.\d+)?)× (.*)$/.exec(e.amountText);
  const base = m ? m[2] : e.amountText;
  const total = (m ? Number(m[1]) : 1) * factor;
  return !base || Math.abs(total - 1) < 0.005 ? base : `${Math.round(total * 100) / 100}× ${base}`;
}

/** An entry at a new amount: by grams when it has per-100 g values, otherwise by a plain multiplier of what it was. */
export function rescaleEntry<T extends FoodEntry>(e: T, opts: { grams?: number; factor?: number }): T {
  if (opts.grams !== undefined && e.per100) {
    const m = atGrams(e.per100, opts.grams);
    return { ...e, ...m, grams: opts.grams, amountText: `${r0(opts.grams)} g` };
  }
  const f = opts.factor ?? (opts.grams !== undefined && e.grams ? opts.grams / e.grams : 1);
  const m = { kcal: r0(e.kcal * f), protein: r1(e.protein * f), carbs: r1(e.carbs * f), fat: r1(e.fat * f) };
  return { ...e, ...m, ...(e.grams ? { grams: r0(e.grams * f) } : {}), amountText: scaledAmountText(e, f) };
}

/* ---------------- Targets ---------------- */
export const KCAL_MIN_SELF = 1200;
export const KCAL_MIN_COACH = 800;
export const KCAL_MAX = 6000;

/** Checks a set of targets. Returns an error message, or null when they are fine. */
export function checkTargets(t: Macros, setBy: "COACH" | "CLIENT"): string | null {
  if (![t.kcal, t.protein, t.carbs, t.fat].every(finite)) return "Enter numbers for the targets.";
  const min = setBy === "COACH" ? KCAL_MIN_COACH : KCAL_MIN_SELF;
  if (t.kcal < min) return setBy === "COACH" ? `Calories can't be set below ${KCAL_MIN_COACH} a day here.` : `Calorie targets below ${KCAL_MIN_SELF} a day aren't offered without a coach. Ask your coach or a doctor.`;
  if (t.kcal > KCAL_MAX) return `Calories can't be above ${KCAL_MAX} a day.`;
  if (t.protein < 0 || t.protein > 500) return "Protein must be between 0 and 500 g.";
  if (t.carbs < 0 || t.carbs > 1000) return "Carbs must be between 0 and 1000 g.";
  if (t.fat < 0 || t.fat > 400) return "Fat must be between 0 and 400 g.";
  if (t.protein <= 0) return "Set a protein target.";
  return null;
}

export type Sex = "male" | "female";
export type Activity = "sedentary" | "light" | "moderate" | "very";
export type CalcGoal = "lose" | "maintain" | "gain";
export const ACTIVITY_LABEL: Record<Activity, string> = { sedentary: "Mostly sitting", light: "Light (1-3 workouts a week)", moderate: "Moderate (3-5 workouts a week)", very: "Very active (6+ workouts a week)" };
const ACTIVITY_FACTOR: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725 };

export interface CalcInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: CalcGoal;
}

/** A starting point from the Mifflin-St Jeor equation. Adults only; never below the minimum; always an estimate. */
export function calcTargets(i: CalcInput): { ok: true; targets: Macros; maintenance: number; notes: string[] } | { ok: false; error: string } {
  if (!finite(i.age) || i.age < 18) return { ok: false, error: "Calorie targets aren't offered under 18. Talk to your coach or a doctor." };
  if (i.age > 100 || !finite(i.heightCm) || i.heightCm < 120 || i.heightCm > 230 || !finite(i.weightKg) || i.weightKg < 30 || i.weightKg > 300) return { ok: false, error: "Check the age, height and weight you entered." };
  const bmr = 10 * i.weightKg + 6.25 * i.heightCm - 5 * i.age + (i.sex === "male" ? 5 : -161);
  const maintenance = bmr * ACTIVITY_FACTOR[i.activity];
  const goalFactor = i.goal === "lose" ? 0.8 : i.goal === "gain" ? 1.1 : 1;
  const notes: string[] = [];
  let kcal = maintenance * goalFactor;
  if (kcal < KCAL_MIN_SELF) {
    kcal = KCAL_MIN_SELF;
    notes.push(`Raised to the ${KCAL_MIN_SELF} kcal minimum. If you want to eat less, do it with your coach or a doctor.`);
  }
  const perKg = i.goal === "lose" ? 2 : i.goal === "gain" ? 1.8 : 1.6;
  const protein = Math.min(perKg * i.weightKg, (kcal * 0.4) / 4);
  const fat = (kcal * 0.25) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  notes.push("This is an estimate to start from. Adjust it after two or three weeks based on how your weight and energy respond.");
  return { ok: true, targets: { kcal: r0(kcal), protein: r0(protein), carbs: r0(carbs), fat: r0(fat) }, maintenance: r0(maintenance), notes };
}

/* ---------------- Days and weeks ---------------- */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dayAdd(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function daysBack(endDay: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => dayAdd(endDay, i - (count - 1)));
}

/** A day counts as on target when calories are within 10% of the target and protein reached at least 90% of its target. */
export function dayOnTarget(total: Macros, t: Macros): boolean {
  if (t.kcal <= 0) return false;
  const kcalOk = total.kcal >= t.kcal * 0.9 && total.kcal <= t.kcal * 1.1;
  const proteinOk = t.protein <= 0 || total.protein >= t.protein * 0.9;
  return kcalOk && proteinOk;
}

export interface DaySummary extends Macros {
  day: string;
  logged: boolean;
  entries: number;
  onTarget: boolean;
}
export interface WeekSummary {
  days: DaySummary[];
  loggedDays: number;
  onTargetDays: number;
  avgKcal: number;
  avgProtein: number;
}

export function weekSummary(entries: readonly FoodEntry[], days: readonly string[], targets?: Macros | null): WeekSummary {
  const per = days.map((day) => {
    const list = entries.filter((e) => e.day === day);
    const t = sumMacros(list);
    return { day, ...t, logged: list.length > 0, entries: list.length, onTarget: !!targets && list.length > 0 && dayOnTarget(t, targets) };
  });
  const logged = per.filter((d) => d.logged);
  return {
    days: per,
    loggedDays: logged.length,
    onTargetDays: per.filter((d) => d.onTarget).length,
    avgKcal: logged.length ? r0(logged.reduce((n, d) => n + d.kcal, 0) / logged.length) : 0,
    avgProtein: logged.length ? r0(logged.reduce((n, d) => n + d.protein, 0) / logged.length) : 0,
  };
}

/** The foods this person logged most recently, once each, newest first (for one-tap re-adding). */
export function recentFoods(entries: readonly FoodEntry[], limit = 12): FoodEntry[] {
  const seen = new Set<string>();
  const out: FoodEntry[] = [];
  for (const e of [...entries].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))) {
    const key = `${e.name.toLowerCase()}|${e.brand?.toLowerCase() ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

export const DISCLAIMER = "Food numbers are estimates, not medical or dietary advice. If you have a medical condition, are pregnant or have a history of disordered eating, check with a doctor or dietitian first.";
