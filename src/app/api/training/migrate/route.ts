import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { migrateLocal } from "@/lib/server/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { workouts?, templates?, exercises?, starters? } — one-time upload of what this browser kept locally before workouts moved to the database. Existing ids are never overwritten. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 200) : []);
  const result = await migrateLocal(me, {
    workouts: list(body.workouts),
    templates: list(body.templates),
    exercises: list(body.exercises),
    starters: body.starters === true,
  });
  return NextResponse.json(result);
});
