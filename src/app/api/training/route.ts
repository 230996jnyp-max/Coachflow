import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { globalFor, nichesOf } from "@/lib/server/niche";
import { loadTraining } from "@/lib/server/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?since=<ISO> — this user's workouts (only those changed since `since`), plus every visible workout id, routines and custom
 * exercises, and the shared niche drills for the niches the coach works in (all of them on a full load, only new ones after that).
 */
export const GET = route(async (req) => {
  const me = await requireUser();
  const raw = new URL(req.url).searchParams.get("since");
  const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : undefined;
  const payload = await loadTraining(me, since);
  const scope = await nichesOf(me);
  const global = scope ? await globalFor(scope.niches, scope.hidden, since) : [];
  return NextResponse.json({ ...payload, global, globalFull: !since });
});
