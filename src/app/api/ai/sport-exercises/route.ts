import { NextResponse } from "next/server";
import { SEED_EXERCISES } from "@/data/exercises";
import { aiConfigured, aiSportExercises } from "@/lib/server/ai";
import { requireUser } from "@/lib/server/auth";
import { badRequest, HttpError, int, readJson, route, str } from "@/lib/server/http";
import { customExercisesFor } from "@/lib/server/training";
import { SUB_CATEGORIES, disciplineOf } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { sport, count?, subCategory?, existing? } - AI designs sport-specific drills (technique, footwork, conditioning,
 * mobility) for any sport, each with a suggested tracking format. Nothing is saved here: the coach reviews the list first.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  if (!aiConfigured()) throw new HttpError(503, "AI isn't set up.");
  const sport = str(body.sport, "Sport", { min: 2, max: 60 });
  if (/[<>{}]/.test(sport)) throw badRequest("Please type just the name of a sport or discipline.");
  const count = "count" in body ? int(body.count, "How many", 6, 24) : 20;
  const subCategory = typeof body.subCategory === "string" && (SUB_CATEGORIES as readonly string[]).includes(body.subCategory) ? body.subCategory : undefined;

  // Names already in the library for this sport (and anything the browser knows about), so the AI adds new drills.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const library = [...SEED_EXERCISES, ...(await customExercisesFor(me))];
  const existing = library.filter((e) => norm(disciplineOf(e)) === norm(sport) || norm(disciplineOf(e)).startsWith(norm(sport))).map((e) => e.name);
  for (const n of Array.isArray(body.existing) ? body.existing.slice(0, 80) : []) if (typeof n === "string") existing.push(n.slice(0, 80));

  const result = await aiSportExercises({ sport, count, existing, subCategory });
  return NextResponse.json(result);
});
