import { NextResponse } from "next/server";
import { MEALS } from "@/lib/nutrition";
import { aiConfigured } from "@/lib/server/ai";
import { refundAiQuota, takeAiQuota } from "@/lib/server/aiQuota";
import { requireUser } from "@/lib/server/auth";
import { HttpError, readJson, route } from "@/lib/server/http";
import { getSettings } from "@/lib/server/nutrition";
import { aiEstimateFood } from "@/lib/server/nutritionAi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Estimates per person per day. The free AI allowance is shared, so it is rationed; entering the numbers by hand always works. */
const DAILY_ESTIMATES = 15;

/**
 * POST { text?, image?, meal? } - estimates what was eaten from a photo (a shrunk JPEG data URL) and/or a description.
 * Counts against 15 estimates a day (an estimate that fails for our reasons is given back). The photo is not stored.
 */
export const POST = route(async (req) => {
  const body = await readJson(req, 2_000_000);
  const me = await requireUser();
  if (!aiConfigured()) throw new HttpError(503, "Food estimates aren't set up on this server. You can still add food by search, barcode or by typing the numbers.");
  const text = typeof body.text === "string" ? body.text.slice(0, 600) : undefined;
  const image = typeof body.image === "string" ? body.image : undefined;
  if (!text?.trim() && !image) throw new HttpError(400, "Describe what you ate, or add a photo.");
  const meal = MEALS.find((m) => m.id === body.meal)?.label;
  const settings = await getSettings(me.id);
  await takeAiQuota(me.id, "nutrition", DAILY_ESTIMATES, "food estimates");
  try {
    const est = await aiEstimateFood({ text, image, meal, diets: settings.diets, allergies: settings.allergies });
    return NextResponse.json(est);
  } catch (e) {
    await refundAiQuota(me.id, "nutrition");
    throw e;
  }
});
