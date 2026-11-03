import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { ALLERGIES, checkTargets, DAY_RE, DIETS, FOOD_SOURCES, isFoodTag, MEALS, r0, r1, type Confidence, type DietaryProfile, type FoodComment, type FoodEntry, type Macros, type NutritionTargets } from "@/lib/nutrition";
import { loadClientFor } from "./accounts";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { notify } from "./groups";
import { badRequest, forbidden, notFound } from "./http";
import { nutritionComments, nutritionEntries, nutritionSettings, nutritionTargets, type NutritionEntryRow, type UserRow } from "./schema";

/*
 * The food diary. Entries, targets, diet settings and comments are stored encrypted, bound to their row id, like workouts. Only the
 * person themselves writes entries, targets and diet settings; their coach reads them, sets targets, and comments on days.
 */

const aadE = (id: string) => `nutrition:${id}`;
const aadT = (id: string) => `nutrition-targets:${id}`;
const aadS = (id: string) => `nutrition-settings:${id}`;
const aadC = (id: string) => `nutrition-comment:${id}`;
const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

/** Today's date in Singapore. Used to refuse entries for impossible days, with a day of slack either side for time zones. */
const sgToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

const MAX_ENTRIES_PER_DAY = 80;
const MAX_RANGE_DAYS = 120;

/* ---------------- Field helpers ---------------- */
function realDay(v: unknown, name = "Day"): string {
  if (typeof v !== "string" || !DAY_RE.test(v)) throw badRequest(`${name} is not valid.`);
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d || y < 2020 || y > 2100) throw badRequest(`${name} is not valid.`);
  return v;
}
function entryDay(v: unknown): string {
  const day = realDay(v);
  const t = Date.parse(`${day}T00:00:00Z`);
  const today = Date.parse(`${sgToday()}T00:00:00Z`);
  if (t > today + 2 * 86_400_000 || t < today - 400 * 86_400_000) throw badRequest("That day is out of range.");
  return day;
}
function num(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw badRequest(`${name} is out of range.`);
  return v;
}
function optNum(v: unknown, name: string, min: number, max: number): number | undefined {
  return v === undefined || v === null ? undefined : num(v, name, min, max);
}
function text(v: unknown, name: string, max: number, required = false): string {
  if (v === undefined || v === null || v === "") {
    if (required) throw badRequest(`${name} is required.`);
    return "";
  }
  if (typeof v !== "string") throw badRequest(`${name} must be text.`);
  const s = v.replace(/\s+/g, " ").trim();
  if (required && !s) throw badRequest(`${name} is required.`);
  if (s.length > max) throw badRequest(`${name} is too long.`);
  return s;
}
function macros(v: unknown, name: string, max: { kcal: number; protein: number; carbs: number; fat: number }): Macros {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw badRequest(`${name} is not valid.`);
  const r = v as Record<string, unknown>;
  return { kcal: r0(num(r.kcal, "Calories", 0, max.kcal)), protein: r1(num(r.protein, "Protein", 0, max.protein)), carbs: r1(num(r.carbs, "Carbs", 0, max.carbs)), fat: r1(num(r.fat, "Fat", 0, max.fat)) };
}

/** Rebuilds a food entry field by field from what the browser sent. */
export function parseEntry(raw: unknown, id: string, now = new Date()): FoodEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest("Food entry is not valid.");
  const r = raw as Record<string, unknown>;
  const meal = MEALS.find((m) => m.id === r.meal)?.id;
  if (!meal) throw badRequest("Choose a meal.");
  const source = FOOD_SOURCES.find((s) => s === r.source);
  if (!source) throw badRequest("Unknown food source.");
  const total = macros(r, "Food", { kcal: 6000, protein: 1000, carbs: 1000, fat: 1000 });
  const brand = text(r.brand, "Brand", 80);
  const grams = optNum(r.grams, "Amount", 0, 10_000);
  const confidence = (["high", "medium", "low"] as Confidence[]).find((c) => c === r.confidence);
  const contains = Array.isArray(r.contains) ? [...new Set(r.contains.filter(isFoodTag))].slice(0, 13) : [];
  const loggedAt = typeof r.loggedAt === "string" && !Number.isNaN(Date.parse(r.loggedAt)) ? new Date(r.loggedAt).toISOString() : now.toISOString();
  return {
    id,
    day: entryDay(r.day),
    meal,
    loggedAt,
    name: text(r.name, "Name", 120, true),
    ...(brand ? { brand } : {}),
    amountText: text(r.amountText, "Amount", 80),
    ...(grams !== undefined && grams > 0 ? { grams: r1(grams) } : {}),
    ...total,
    ...(r.per100 ? { per100: macros(r.per100, "Per 100 g", { kcal: 950, protein: 100, carbs: 100, fat: 100 }) } : {}),
    source,
    approx: r.approx === true,
    ...(confidence ? { confidence } : {}),
    ...(contains.length ? { contains } : {}),
  };
}

/* ---------------- Who may see what ---------------- */
export interface Subject {
  id: string;
  self: boolean;
}

/** The person whose diary is being read or changed: me, or (for a coach) one of my clients. */
export async function subjectFor(me: UserRow, clientId: unknown): Promise<Subject> {
  if (clientId === undefined || clientId === null || clientId === "" || clientId === me.id) return { id: me.id, self: true };
  if (typeof clientId !== "string") throw badRequest("Client is not valid.");
  if (me.role === "CLIENT") throw forbidden();
  const row = await loadClientFor(me, clientId);
  if (!row) throw notFound("Client not found.");
  return { id: row.id, self: false };
}

/* ---------------- Entries ---------------- */
const openEntry = (row: NutritionEntryRow): FoodEntry | null => {
  try {
    return { ...decryptJson<FoodEntry>(row.dataEnc, aadE(row.id)), id: row.id, day: row.day };
  } catch (e) {
    console.error("Could not decrypt a food entry", row.id, e instanceof Error ? e.message : "");
    return null;
  }
};

export async function listEntries(clientId: string, from: string, to: string): Promise<FoodEntry[]> {
  const d = await db();
  const rows = await d.select().from(nutritionEntries).where(and(eq(nutritionEntries.clientId, clientId), gte(nutritionEntries.day, from), lte(nutritionEntries.day, to))).orderBy(asc(nutritionEntries.day));
  return rows.map(openEntry).filter((e): e is FoodEntry => e !== null).sort((a, b) => a.day.localeCompare(b.day) || a.loggedAt.localeCompare(b.loggedAt));
}

export async function addEntry(me: UserRow, raw: unknown): Promise<FoodEntry> {
  const id = newId("fe");
  const e = parseEntry(raw, id);
  const d = await db();
  const [n] = await d.select({ n: sql<number>`count(*)::int` }).from(nutritionEntries).where(and(eq(nutritionEntries.clientId, me.id), eq(nutritionEntries.day, e.day)));
  if ((n?.n ?? 0) >= MAX_ENTRIES_PER_DAY) throw badRequest("That's a lot of foods for one day. Delete some before adding more.");
  await d.insert(nutritionEntries).values({ id, clientId: me.id, day: e.day, dataEnc: encryptJson(e, aadE(id)) });
  return e;
}

export async function updateEntry(me: UserRow, id: string, raw: unknown): Promise<FoodEntry> {
  const d = await db();
  const [row] = await d.select().from(nutritionEntries).where(eq(nutritionEntries.id, id)).limit(1);
  if (!row || row.clientId !== me.id) throw notFound("That food entry wasn't found.");
  const e = parseEntry(raw, id);
  await d.update(nutritionEntries).set({ day: e.day, dataEnc: encryptJson(e, aadE(id)), updatedAt: new Date() }).where(eq(nutritionEntries.id, id));
  return e;
}

export async function removeEntry(me: UserRow, id: string): Promise<void> {
  const d = await db();
  await d.delete(nutritionEntries).where(and(eq(nutritionEntries.id, id), eq(nutritionEntries.clientId, me.id)));
}

/* ---------------- Settings (diets, allergies, adult) ---------------- */
const EMPTY_SETTINGS: DietaryProfile = { adult: null, diets: [], allergies: [], other: "" };

export async function getSettings(clientId: string): Promise<DietaryProfile> {
  const d = await db();
  const [row] = await d.select().from(nutritionSettings).where(eq(nutritionSettings.clientId, clientId)).limit(1);
  if (!row) return EMPTY_SETTINGS;
  try {
    return { ...EMPTY_SETTINGS, ...decryptJson<DietaryProfile>(row.dataEnc, aadS(clientId)) };
  } catch {
    return EMPTY_SETTINGS;
  }
}

/** The person's own answers. Saying they are under 18 removes any calorie targets. */
export async function setSettings(me: UserRow, raw: unknown): Promise<DietaryProfile> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest("Settings are not valid.");
  const r = raw as Record<string, unknown>;
  const cur = await getSettings(me.id);
  const adult = "adult" in r ? (r.adult === true ? true : r.adult === false ? false : null) : cur.adult;
  const pick = (v: unknown, allowed: string[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : []);
  const next: DietaryProfile = {
    adult,
    diets: "diets" in r ? pick(r.diets, Object.keys(DIETS)) : cur.diets,
    allergies: "allergies" in r ? pick(r.allergies, Object.keys(ALLERGIES)) : cur.allergies,
    other: "other" in r ? text(r.other, "Other", 200) : cur.other,
  };
  const d = await db();
  await d.insert(nutritionSettings).values({ clientId: me.id, dataEnc: encryptJson(next, aadS(me.id)) }).onConflictDoUpdate({ target: nutritionSettings.clientId, set: { dataEnc: encryptJson(next, aadS(me.id)), updatedAt: new Date() } });
  if (adult === false) await d.delete(nutritionTargets).where(eq(nutritionTargets.clientId, me.id));
  return next;
}

/* ---------------- Targets ---------------- */
export async function getTargets(clientId: string): Promise<NutritionTargets | null> {
  const d = await db();
  const [row] = await d.select().from(nutritionTargets).where(eq(nutritionTargets.clientId, clientId)).limit(1);
  if (!row) return null;
  try {
    return decryptJson<NutritionTargets>(row.dataEnc, aadT(clientId));
  } catch {
    return null;
  }
}

/**
 * Sets (or clears) calorie and macro targets. A coach sets them for their own client (not below 800 kcal); a person sets their
 * own (not below 1,200 kcal) unless their coach already set them. Nobody under 18 gets targets.
 */
export async function setTargets(me: UserRow, subject: Subject, raw: unknown): Promise<NutritionTargets | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest("Targets are not valid.");
  const r = raw as Record<string, unknown>;
  const d = await db();
  const existing = await getTargets(subject.id);
  if (r.clear === true) {
    if (subject.self && existing?.setBy === "COACH") throw forbidden("Your coach set your targets. Ask them to change them.");
    await d.delete(nutritionTargets).where(eq(nutritionTargets.clientId, subject.id));
    return null;
  }
  const settings = await getSettings(subject.id);
  if (settings.adult === false) throw badRequest("Calorie targets aren't offered under 18.");
  const setBy = subject.self ? "CLIENT" : "COACH";
  if (subject.self && existing?.setBy === "COACH") throw forbidden("Your coach set your targets. Ask them to change them.");
  const t: Macros = { kcal: r0(num(r.kcal, "Calories", 0, 100_000)), protein: r1(num(r.protein, "Protein", 0, 100_000)), carbs: r1(num(r.carbs ?? 0, "Carbs", 0, 100_000)), fat: r1(num(r.fat ?? 0, "Fat", 0, 100_000)) };
  const bad = checkTargets(t, setBy);
  if (bad) throw badRequest(bad);
  const out: NutritionTargets = { ...t, setBy, at: new Date().toISOString() };
  await d.insert(nutritionTargets).values({ clientId: subject.id, dataEnc: encryptJson(out, aadT(subject.id)) }).onConflictDoUpdate({ target: nutritionTargets.clientId, set: { dataEnc: encryptJson(out, aadT(subject.id)), updatedAt: new Date() } });
  if (!subject.self) await notify([subject.id], "nutrition_targets", { title: "Your coach set your nutrition targets", body: `${out.kcal} kcal and ${out.protein} g protein a day. See them in your Nutrition tab.`, link: "/nutrition" }, { email: false });
  return out;
}

/* ---------------- Comments (coach, per day) ---------------- */
export async function listComments(clientId: string, from: string, to: string): Promise<FoodComment[]> {
  const d = await db();
  const rows = await d.select().from(nutritionComments).where(and(eq(nutritionComments.clientId, clientId), gte(nutritionComments.day, from), lte(nutritionComments.day, to))).orderBy(asc(nutritionComments.createdAt));
  const out: FoodComment[] = [];
  for (const r of rows) {
    try {
      out.push({ ...decryptJson<FoodComment>(r.dataEnc, aadC(r.id)), id: r.id, day: r.day });
    } catch {
      /* skip an unreadable comment */
    }
  }
  return out;
}

export async function addComment(me: UserRow, subject: Subject, rawDay: unknown, rawText: unknown): Promise<FoodComment> {
  if (subject.self || me.role === "CLIENT") throw forbidden("Only a coach can comment on a client's diary.");
  const day = realDay(rawDay);
  const body = text(rawText, "Comment", 500, true);
  const d = await db();
  const [n] = await d.select({ n: sql<number>`count(*)::int` }).from(nutritionComments).where(and(eq(nutritionComments.clientId, subject.id), eq(nutritionComments.day, day)));
  if ((n?.n ?? 0) >= 30) throw badRequest("That day has a lot of comments already.");
  const id = newId("fc");
  const c: FoodComment = { id, day, authorId: me.id, authorName: me.name ?? me.username, text: body, at: new Date().toISOString() };
  await d.insert(nutritionComments).values({ id, clientId: subject.id, day, dataEnc: encryptJson(c, aadC(id)) });
  await notify([subject.id], "nutrition_comment", { title: "Your coach commented on your food diary", body: body.length > 140 ? `${body.slice(0, 137)}…` : body, link: `/nutrition?day=${day}` }, { email: false });
  return c;
}

/* ---------------- Everything for a screen ---------------- */
export interface NutritionBundle {
  entries: FoodEntry[];
  targets: NutritionTargets | null;
  settings: DietaryProfile;
  comments: FoodComment[];
  /** True when this is my own diary. */
  self: boolean;
}

export async function loadBundle(me: UserRow, clientId: unknown, rawFrom: unknown, rawTo: unknown): Promise<NutritionBundle> {
  const subject = await subjectFor(me, clientId);
  const from = realDay(rawFrom, "From");
  const to = realDay(rawTo, "To");
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (span < 0 || span > MAX_RANGE_DAYS) throw badRequest("Choose a shorter range of days.");
  const [entries, targets, settings, comments] = await Promise.all([listEntries(subject.id, from, to), getTargets(subject.id), getSettings(subject.id), listComments(subject.id, from, to)]);
  return { entries, targets, settings, comments, self: subject.self };
}

/** Deleting a client removes their food diary too. */
export async function purgeClientNutrition(clientId: string): Promise<void> {
  const d = await db();
  await d.delete(nutritionEntries).where(eq(nutritionEntries.clientId, clientId));
  await d.delete(nutritionTargets).where(eq(nutritionTargets.clientId, clientId));
  await d.delete(nutritionSettings).where(eq(nutritionSettings.clientId, clientId));
  await d.delete(nutritionComments).where(eq(nutritionComments.clientId, clientId));
}
