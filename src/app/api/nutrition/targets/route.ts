import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { setTargets, subjectFor } from "@/lib/server/nutrition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT { kcal, protein, carbs, fat } or { clear: true }, plus { clientId } for a coach.
 * A coach sets their client's targets; a person sets their own unless their coach did. Nobody under 18 gets targets.
 */
export const PUT = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  const subject = await subjectFor(me, body.clientId);
  return NextResponse.json({ targets: await setTargets(me, subject, body) });
});
