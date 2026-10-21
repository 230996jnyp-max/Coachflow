import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { loadTraining } from "@/lib/server/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?since=<ISO> — this user's workouts (only those changed since `since`), plus every visible workout id, routines and custom exercises. */
export const GET = route(async (req) => {
  const me = await requireUser();
  const raw = new URL(req.url).searchParams.get("since");
  const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : undefined;
  return NextResponse.json(await loadTraining(me, since));
});
