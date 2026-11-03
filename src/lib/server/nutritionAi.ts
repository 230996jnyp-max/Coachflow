import "server-only";
import { FOOD_TAGS, isFoodTag, reconcileKcal, r0, r1, type Confidence, type Estimate, type EstimatedItem } from "@/lib/nutrition";
import { DATA_URL, groq, jsonFrom, MAX_IMAGE_DATA_URL, TEXT_MODEL, VISION_MODEL } from "./ai";
import { HttpError } from "./http";

/*
 * Estimating a meal from a photo or a few words, for any cuisine. The model's answer is never trusted as is: every field is
 * re-validated and clamped, calories that don't match the macros are corrected, and the result is always shown as an estimate
 * the person can change before saving. Photos are read and thrown away; nothing about the image is kept.
 */

export interface EstimateInput {
  text?: string;
  /** A JPEG / PNG / WebP data URL (already shrunk by the browser). */
  image?: string;
  meal?: string;
  diets: string[];
  allergies: string[];
}

const SYSTEM = `You are a careful nutrition estimator inside a fitness coaching app. You get a photo of a meal or a short description of what someone ate, and you estimate what they ate. Return ONLY a JSON object:
{"items":[{"name":"Hainanese chicken rice","amount":"1 plate (about 350 g)","grams":350,"kcal":610,"protein":28,"carbs":82,"fat":18,"confidence":"medium","contains":["meat","soy"]}],"note":""}
Rules:
- Any food from any cuisine in the world. Name dishes the way people know them.
- List the main foods separately (at most 8 items), but keep one dish as ONE item when it is eaten as one (a plate of chicken rice, a bowl of ramen, a burger).
- Estimate realistic portions from what you can see or are told. If a quantity is given in the description, use it exactly.
- All numbers are TOTALS for the amount eaten (not per 100 g). "grams" is the approximate weight of that portion. Protein, carbs and fat are in grams; kcal should roughly equal 4 x protein + 4 x carbs + 9 x fat.
- Include cooking oil, sauces and dressings you can reasonably expect. Use typical values.
- "confidence" is "high" for simple, clearly shown or well-described foods, "medium" for typical dishes, "low" when the portion or the ingredients are unclear (mixed dishes, sauces, hidden oil).
- "contains": only tags from [${FOOD_TAGS.join(", ")}] that the food probably contains. Use "pork" for pork, "beef" for beef and "meat" for any other meat (chicken, lamb, duck...). Add "alcohol" for drinks or dishes with alcohol. Be careful with allergens: include a tag when it is likely, even if not certain.
- Never give medical advice. If there is no food in the photo or description, return {"items":[],"note":"No food found."}.
- "note" is at most one short sentence, or empty.`;

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const n = (v: unknown, min: number, max: number): number | undefined => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : undefined;
};

/** Turns the model's JSON into safe, consistent items (or throws when nothing usable came back). */
export function sanitizeEstimate(raw: unknown): Estimate {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(r.items) ? r.items : [];
  const items: EstimatedItem[] = [];
  for (const it of list.slice(0, 8)) {
    if (!it || typeof it !== "object") continue;
    const x = it as Record<string, unknown>;
    const name = clean(x.name, 80);
    const protein = n(x.protein, 0, 400) ?? 0;
    const carbs = n(x.carbs, 0, 800) ?? 0;
    const fat = n(x.fat, 0, 400) ?? 0;
    const kcal = n(x.kcal, 0, 4000) ?? 0;
    if (!name || kcal + protein + carbs + fat <= 0) continue;
    const contains = [...new Set(Array.isArray(x.contains) ? x.contains.filter(isFoodTag) : [])];
    const { macros, adjusted } = reconcileKcal({ kcal, protein, carbs, fat }, { alcohol: contains.includes("alcohol") });
    const grams = n(x.grams, 1, 5000);
    let confidence: Confidence = x.confidence === "high" || x.confidence === "low" ? x.confidence : "medium";
    if (adjusted && confidence === "high") confidence = "medium";
    items.push({
      name,
      amountText: clean(x.amount ?? x.amountText, 80) || (grams ? `about ${r0(grams)} g` : "1 serving"),
      ...(grams ? { grams: r0(grams) } : {}),
      kcal: r0(macros.kcal),
      protein: r1(macros.protein),
      carbs: r1(macros.carbs),
      fat: r1(macros.fat),
      confidence,
      contains,
    });
  }
  return { items, note: clean(r.note, 160) };
}

function userText(i: EstimateInput): string {
  const parts: string[] = [];
  if (i.meal) parts.push(`Meal: ${i.meal}.`);
  if (i.diets.length || i.allergies.length) parts.push(`The person's diets: ${i.diets.join(", ") || "none"}. Allergies: ${i.allergies.join(", ") || "none"}. This is only so "contains" is careful; do not change quantities because of it.`);
  parts.push(i.text ? `What they ate (their words): """${i.text.slice(0, 600)}"""` : "Estimate what is on the plate in the photo.");
  return parts.join("\n");
}

export async function aiEstimateFood(i: EstimateInput): Promise<Estimate> {
  let content: string;
  if (i.image) {
    if (!DATA_URL.test(i.image) || i.image.length > MAX_IMAGE_DATA_URL) throw new HttpError(415, "That photo is too large or in an unsupported format. Try another one.");
    content = await groq(
      {
        model: VISION_MODEL,
        temperature: 0.1,
        max_completion_tokens: 2500,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: [{ type: "text", text: userText(i) }, { type: "image_url", image_url: { url: i.image } }] },
        ],
      },
      60_000,
    );
  } else {
    if (!i.text || i.text.trim().length < 2) throw new HttpError(400, "Describe what you ate, or add a photo.");
    content = await groq(
      {
        model: TEXT_MODEL,
        temperature: 0.1,
        reasoning_effort: "low",
        max_completion_tokens: 3000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userText(i) },
        ],
      },
      40_000,
    );
  }
  let parsed: unknown;
  try {
    parsed = jsonFrom(content);
  } catch {
    throw new HttpError(502, "The AI's answer couldn't be read. Try again, or describe the meal in words.");
  }
  return sanitizeEstimate(parsed);
}
