import { NextResponse } from "next/server";
import { aiConfigured, aiCustomTracking } from "@/lib/server/ai";
import { requireUser } from "@/lib/server/auth";
import { HttpError, readJson, route, str } from "@/lib/server/http";
import { sanitizeTracking } from "@/lib/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { exerciseName, sport?, instruction, current? } - AI turns the coach's plain-English request into a tracking format
 * (set columns + the value to chart). Nothing is saved here: the coach previews it and then saves it for the exercise.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  await requireUser(["OWNER", "COACH"]);
  if (!aiConfigured()) throw new HttpError(503, "AI isn't set up.");
  const exerciseName = str(body.exerciseName, "Exercise", { max: 120 });
  const instruction = str(body.instruction, "What to track", { min: 4, max: 600 });
  const sport = typeof body.sport === "string" ? body.sport.slice(0, 60) : undefined;
  const cur = body.current ? sanitizeTracking(body.current) : null;
  const result = await aiCustomTracking({ exerciseName, sport, instruction, current: cur?.ok ? cur.schema : undefined });
  return NextResponse.json(result);
});
