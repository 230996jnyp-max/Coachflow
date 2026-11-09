"use client";

import { useCallback, useEffect, useState } from "react";
import type { CommonFood } from "./commonFoods";
import { r0, type Candidate, type DietaryProfile, type Estimate, type EstimatedItem, type FoodComment, type FoodEntry, type MealType, type NutritionTargets, type PackagedFood } from "./nutrition";
import { api } from "./store";
import { uid } from "./utils";

/* Browser side of the food diary: loading it, saving to it, and turning search / AI / barcode results into entries. */

export interface Bundle {
  entries: FoodEntry[];
  targets: NutritionTargets | null;
  settings: DietaryProfile;
  comments: FoodComment[];
  self: boolean;
}

/** The person's own calendar day, as yyyy-MM-dd. */
export function dayString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The meal that fits the time of day (a late snack counts as a snack). */
export function mealForTime(d: Date = new Date()): MealType {
  const h = d.getHours();
  return h < 10 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snack";
}

/** Loads a range of days (for me, or for one of my clients when I am their coach). Call `reload` after a change. */
export function useDiary(clientId: string | undefined, from: string, to: string) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; bundle: Bundle | null; error: string | null }>({ key: "", bundle: null, error: null });
  const key = `${clientId ?? "me"}|${from}|${to}|${tick}`;
  useEffect(() => {
    let alive = true;
    void api<Bundle>(`/api/nutrition?from=${from}&to=${to}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ""}`).then((r) => {
      if (!alive) return;
      setState((prev) => ({ key, bundle: r.ok && r.data ? r.data : prev.bundle, error: r.ok ? null : (r.error ?? "Couldn't load the food diary.") }));
    });
    return () => {
      alive = false;
    };
  }, [key, clientId, from, to]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { bundle: state.bundle, error: state.error, loading: state.key !== key, reload };
}

/* ---------------- Candidates ---------------- */
const base = { approx: false } as const;

export function candidateFromCommon(f: CommonFood): Candidate {
  return {
    key: uid("c"),
    name: f.name,
    amountText: `${f.servingLabel} (${r0(f.servingGrams)} g)`,
    grams: f.servingGrams,
    ...scaleTo(f.per100, f.servingGrams),
    per100: f.per100,
    source: "COMMON",
    approx: f.dish,
    ...(f.contains.length ? { contains: f.contains } : {}),
  };
}

export function candidateFromPackaged(p: PackagedFood, source: "SEARCH" | "BARCODE"): Candidate {
  const grams = p.servingGrams ?? 100;
  return {
    key: uid("c"),
    name: p.name,
    ...(p.brand ? { brand: p.brand } : {}),
    amountText: p.servingGrams ? `1 serving (${r0(grams)} g)` : "100 g",
    grams,
    ...scaleTo(p.per100, grams),
    per100: p.per100,
    source,
    ...base,
    ...(p.contains.length ? { contains: p.contains } : {}),
  };
}

export function candidateFromEstimate(i: EstimatedItem, source: "AI_PHOTO" | "AI_TEXT"): Candidate {
  return {
    key: uid("c"),
    name: i.name,
    amountText: i.amountText,
    ...(i.grams ? { grams: i.grams } : {}),
    kcal: i.kcal,
    protein: i.protein,
    carbs: i.carbs,
    fat: i.fat,
    source,
    approx: true,
    confidence: i.confidence,
    ...(i.contains.length ? { contains: i.contains } : {}),
  };
}

export function candidateFromEntry(e: FoodEntry): Candidate {
  return {
    key: uid("c"),
    name: e.name,
    ...(e.brand ? { brand: e.brand } : {}),
    amountText: e.amountText,
    ...(e.grams ? { grams: e.grams } : {}),
    kcal: e.kcal,
    protein: e.protein,
    carbs: e.carbs,
    fat: e.fat,
    ...(e.per100 ? { per100: e.per100 } : {}),
    source: "RECENT",
    approx: e.approx,
    ...(e.confidence ? { confidence: e.confidence } : {}),
    ...(e.contains ? { contains: e.contains } : {}),
  };
}

export function manualCandidate(i: { name: string; amountText: string; kcal: number; protein: number; carbs: number; fat: number }): Candidate {
  return { key: uid("c"), name: i.name, amountText: i.amountText, kcal: i.kcal, protein: i.protein, carbs: i.carbs, fat: i.fat, source: "MANUAL", ...base };
}

function scaleTo(per100: { kcal: number; protein: number; carbs: number; fat: number }, grams: number) {
  const f = grams / 100;
  return { kcal: Math.round(per100.kcal * f), protein: Math.round(per100.protein * f * 10) / 10, carbs: Math.round(per100.carbs * f * 10) / 10, fat: Math.round(per100.fat * f * 10) / 10 };
}

/** What the server wants for one food in a diary day. */
function body(c: Omit<Candidate, "key"> | FoodEntry, day: string, meal: MealType, loggedAt?: string) {
  return {
    day,
    meal,
    ...(loggedAt ? { loggedAt } : {}),
    name: c.name,
    ...(c.brand ? { brand: c.brand } : {}),
    amountText: c.amountText,
    ...(c.grams ? { grams: c.grams } : {}),
    kcal: c.kcal,
    protein: c.protein,
    carbs: c.carbs,
    fat: c.fat,
    ...(c.per100 ? { per100: c.per100 } : {}),
    source: c.source,
    approx: c.approx,
    ...(c.confidence ? { confidence: c.confidence } : {}),
    ...(c.contains ? { contains: c.contains } : {}),
  };
}

/* ---------------- Saving ---------------- */
export async function saveCandidates(day: string, meal: MealType, list: Candidate[]): Promise<string | null> {
  const r = await api("/api/nutrition", { body: { entries: list.map((c) => body(c, day, meal)) } });
  return r.ok ? null : (r.error ?? "Couldn't save that.");
}

export async function saveEntry(e: FoodEntry): Promise<string | null> {
  const r = await api(`/api/nutrition/${e.id}`, { method: "PUT", body: { entry: body(e, e.day, e.meal, e.loggedAt) } });
  return r.ok ? null : (r.error ?? "Couldn't save that.");
}

export async function deleteEntry(id: string): Promise<string | null> {
  const r = await api(`/api/nutrition/${id}`, { method: "DELETE" });
  return r.ok ? null : (r.error ?? "Couldn't delete that.");
}

export async function saveSettings(patch: Partial<DietaryProfile>): Promise<string | null> {
  const r = await api("/api/nutrition/settings", { method: "PUT", body: patch });
  return r.ok ? null : (r.error ?? "Couldn't save that.");
}

export async function saveTargets(input: { kcal: number; protein: number; carbs: number; fat: number } | { clear: true }, clientId?: string): Promise<string | null> {
  const r = await api("/api/nutrition/targets", { method: "PUT", body: { ...input, ...(clientId ? { clientId } : {}) } });
  return r.ok ? null : (r.error ?? "Couldn't save the targets.");
}

export async function postComment(clientId: string, day: string, text: string): Promise<string | null> {
  const r = await api("/api/nutrition/comments", { body: { clientId, day, text } });
  return r.ok ? null : (r.error ?? "Couldn't send that.");
}

/* ---------------- Lookups ---------------- */
export async function estimateFood(input: { text?: string; image?: string; meal?: MealType }): Promise<{ estimate: Estimate } | { error: string }> {
  const r = await api<Estimate>("/api/nutrition/estimate", { body: input });
  return r.ok && r.data ? { estimate: r.data } : { error: r.error ?? "The estimate didn't work. Try again, or add the food another way." };
}

export async function searchPackaged(q: string): Promise<{ foods: PackagedFood[]; unavailable: boolean }> {
  const r = await api<{ packaged: PackagedFood[]; unavailable?: string }>(`/api/nutrition/search?q=${encodeURIComponent(q)}`);
  return { foods: r.ok && r.data ? r.data.packaged : [], unavailable: !r.ok || !!r.data?.unavailable };
}

export async function lookupBarcode(code: string): Promise<{ food: PackagedFood | null } | { error: string }> {
  const r = await api<{ food: PackagedFood | null }>(`/api/nutrition/barcode/${encodeURIComponent(code)}`);
  return r.ok && r.data ? { food: r.data.food } : { error: r.error ?? "Couldn't look that up." };
}

/** Shrinks a photo to a small JPEG (long side 1024 px) so it uploads fast and never needs storing. */
export async function shrinkImage(file: File, maxSide = 1024): Promise<string> {
  const bitmap: ImageBitmap | HTMLImageElement = await (async () => {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      const url = URL.createObjectURL(file);
      try {
        return await new Promise<HTMLImageElement>((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = () => rej(new Error("That photo couldn't be opened."));
          img.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  })();
  const w = "naturalWidth" in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h = "naturalHeight" in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("That photo couldn't be processed.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.8, 0.65, 0.5]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= 1_500_000) return url;
  }
  throw new Error("That photo is too large. Try another one.");
}
