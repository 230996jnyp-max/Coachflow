import "server-only";
import type { FoodTag, PackagedFood } from "@/lib/nutrition";
import { HttpError } from "./http";

/*
 * Open Food Facts: a free, open database of packaged foods from around the world (barcodes and names). No key or account is
 * needed. Their data is crowd-sourced, so every value is sanity-checked, and results are cached for a while to be a polite
 * neighbour (they ask apps to identify themselves and to keep search traffic low).
 */

const UA = "CoachFlow/1.0 (https://coachflow.pro; food diary)";
const FIELDS = "code,product_name,generic_name,brands,nutriments,serving_size,serving_quantity,allergens_tags,ingredients_analysis_tags";

const ALLERGEN_TAG: Record<string, FoodTag> = {
  "en:milk": "dairy",
  "en:gluten": "gluten",
  "en:peanuts": "peanut",
  "en:nuts": "tree_nut",
  "en:soybeans": "soy",
  "en:eggs": "egg",
  "en:fish": "fish",
  "en:crustaceans": "shellfish",
  "en:molluscs": "shellfish",
  "en:sesame-seeds": "sesame",
};

const num = (v: unknown): number | undefined => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
};

/** One product from the API, or null when it lacks usable numbers (the database has plenty of bad entries). */
export function toPackaged(p: unknown): PackagedFood | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const nut = (o.nutriments && typeof o.nutriments === "object" ? o.nutriments : {}) as Record<string, unknown>;
  const kj = num(nut["energy_100g"]);
  const kcal = num(nut["energy-kcal_100g"]) ?? (kj !== undefined ? kj / 4.184 : undefined);
  const protein = num(nut["proteins_100g"]) ?? 0;
  const carbs = num(nut["carbohydrates_100g"]) ?? 0;
  const fat = num(nut["fat_100g"]) ?? 0;
  const name = String(o.product_name || o.generic_name || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!name || kcal === undefined || kcal < 0 || kcal > 950 || [protein, carbs, fat].some((x) => x < 0 || x > 100) || protein + carbs + fat > 105) return null;
  const brand = (Array.isArray(o.brands) ? String(o.brands[0] ?? "") : String(o.brands ?? "").split(",")[0]).trim().slice(0, 60);
  const serving = num(o.serving_quantity) ?? (/(\d+(?:\.\d+)?)\s*g\b/i.exec(String(o.serving_size ?? ""))?.[1] ? Number(/(\d+(?:\.\d+)?)\s*g\b/i.exec(String(o.serving_size))![1]) : undefined);
  const contains = new Set<FoodTag>();
  for (const t of Array.isArray(o.allergens_tags) ? o.allergens_tags : []) {
    const tag = ALLERGEN_TAG[String(t)];
    if (tag) contains.add(tag);
  }
  if (Array.isArray(o.ingredients_analysis_tags) && o.ingredients_analysis_tags.includes("en:non-vegetarian")) contains.add("meat");
  return {
    ...(typeof o.code === "string" && /^\d{6,14}$/.test(o.code) ? { code: o.code } : {}),
    name,
    ...(brand ? { brand } : {}),
    per100: { kcal: Math.round(kcal), protein: Math.round(protein * 10) / 10, carbs: Math.round(carbs * 10) / 10, fat: Math.round(fat * 10) / 10 },
    ...(serving && serving > 0 && serving <= 2000 ? { servingGrams: Math.round(serving * 10) / 10, servingLabel: String(o.serving_size ?? "").slice(0, 40) || `${serving} g` } : {}),
    contains: [...contains],
  };
}

const cache = new Map<string, { at: number; value: unknown }>();
function cached<T>(key: string, ttlMs: number): T | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  return undefined;
}
function remember(key: string, value: unknown) {
  if (cache.size > 400) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
  } catch {
    throw new HttpError(503, "The packaged-food database didn't answer. Try again, or search by name or use a photo.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(503, "The packaged-food database is busy. Try again in a moment.");
  return res.json().catch(() => null);
}

/** A product by barcode (EAN / UPC), or null when the database doesn't have it. */
export async function offBarcode(code: string): Promise<PackagedFood | null> {
  if (!/^\d{8,14}$/.test(code)) throw new HttpError(400, "That doesn't look like a barcode number.");
  const key = `b:${code}`;
  const hit = cached<PackagedFood | null>(key, 24 * 3_600_000);
  if (hit !== undefined) return hit;
  const data = (await getJson(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`)) as { status?: number; product?: unknown } | null;
  const out = data?.status === 1 ? toPackaged({ ...(data.product as object), code }) : null;
  remember(key, out);
  return out;
}

/** Packaged foods matching some words (Open Food Facts' own text-search service, best matches first; the older endpoint is the fallback). */
export async function offSearch(query: string): Promise<PackagedFood[]> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 80);
  if (q.length < 2) return [];
  const key = `s:${q.toLowerCase()}`;
  const hit = cached<PackagedFood[]>(key, 3_600_000);
  if (hit) return hit;
  const clean = (list: unknown[] | undefined) => (list ?? []).map(toPackaged).filter((p): p is PackagedFood => p !== null).slice(0, 10);
  let out: PackagedFood[] = [];
  try {
    const data = (await getJson(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=20&fields=${FIELDS}`)) as { hits?: unknown[] } | null;
    out = clean(data?.hits);
  } catch {
    /* fall back to the older endpoint below */
  }
  if (out.length === 0) {
    const data = (await getJson(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}`)) as { products?: unknown[] } | null;
    out = clean(data?.products);
  }
  remember(key, out);
  return out;
}
