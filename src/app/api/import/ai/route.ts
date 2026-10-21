import { NextResponse } from "next/server";
import { SEED_EXERCISES } from "@/data/exercises";
import { aiConfigured, aiReadWorkouts, shortlistLibrary } from "@/lib/server/ai";
import { requireUser } from "@/lib/server/auth";
import { HttpError, readJson, route, str } from "@/lib/server/http";
import { customExercisesFor } from "@/lib/server/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { text, unit, today } — reads pasted workout notes with AI and returns structured workouts mapped to the exercise library. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  if (!aiConfigured()) throw new HttpError(503, "AI reading isn't set up.");
  const text = str(body.text, "Text", { max: 20000 });
  const unit = body.unit === "imperial" ? "imperial" : "metric";
  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const custom = await customExercisesFor(me);
  const library = shortlistLibrary(text, [...SEED_EXERCISES, ...custom].map((e) => ({ id: e.id, name: e.name })));
  const workouts = await aiReadWorkouts({ text, unit, today, library });
  return NextResponse.json({ workouts, model: "ai" });
});
