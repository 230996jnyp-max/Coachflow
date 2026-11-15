import { NextResponse } from "next/server";
import { aiConfigured, aiReadWorkouts, shortlistLibrary } from "@/lib/server/ai";
import { logAiUsage } from "@/lib/server/aiLog";
import { takeAiQuota } from "@/lib/server/aiQuota";
import { requireUser } from "@/lib/server/auth";
import { requireAdult } from "@/lib/server/minors";
import { HttpError, readJson, route, str } from "@/lib/server/http";
import { libraryFor } from "@/lib/server/recap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many AI reads a client gets per day (coaches get more). The free AI allowance is shared, so it is rationed. */
const CLIENT_AI_IMPORTS_PER_DAY = 5;
const COACH_AI_IMPORTS_PER_DAY = 40;

/**
 * POST { text, unit, today } — reads pasted workout notes with AI and returns structured workouts mapped to the exercise library
 * (built-in, the coach's niche drills and the person's own custom exercises). Clients can use it too, within a daily limit; the
 * importer falls back to its built-in reader when the limit is reached.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  requireAdult(me);
  if (!aiConfigured()) throw new HttpError(503, "AI reading isn't set up.");
  const text = str(body.text, "Text", { max: 20000 });
  const unit = body.unit === "imperial" ? "imperial" : "metric";
  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const client = me.role === "CLIENT";
  await takeAiQuota(me.id, "import", client ? CLIENT_AI_IMPORTS_PER_DAY : COACH_AI_IMPORTS_PER_DAY, "AI imports");
  await logAiUsage({ userId: me.id, feature: "workout_import" });
  const library = shortlistLibrary(text, [...(await libraryFor(me)).values()].map((e) => ({ id: e.id, name: e.name })));
  const workouts = await aiReadWorkouts({ text, unit, today, library });
  return NextResponse.json({ workouts, model: "ai" });
});
