import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { coachByCode } from "@/lib/server/coachCode";
import { cancelMine, pendingFor, pendingOf, requestCoach } from "@/lib/server/coachLinks";
import { badRequest, forbidden, notFound, readJson, route } from "@/lib/server/http";
import { hit } from "@/lib/server/rateLimit";
import { cleanCoachCode } from "@/lib/signupRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — a coach: the people waiting for an answer. A client with no coach: the request they have waiting. */
export const GET = route(async () => {
  const me = await requireUser();
  if (me.role === "OWNER" || me.role === "COACH") return NextResponse.json({ requests: await pendingFor(me) });
  if (me.coachId) return NextResponse.json({ pending: null });
  return NextResponse.json({ pending: await pendingOf(me) });
});

/** POST { code } — someone training on their own asks a coach (by code) to take them on. */
export const POST = route(async (req) => {
  const body = await readJson(req, 500);
  const me = await requireUser(["CLIENT"]);
  if (me.coachId) throw forbidden("You already have a coach.");
  await hit(`link:${me.id}`, 8, 86_400_000, "You've asked a lot of coaches today. Try again tomorrow.");
  const code = cleanCoachCode(body.code);
  if (!code) throw badRequest("A coach code is six digits.");
  const coach = await coachByCode(code);
  if (!coach) throw notFound("We couldn't find a coach with that code. Check it with your coach.");
  await requestCoach(me, coach);
  return NextResponse.json({ pending: await pendingOf(me) });
});

/** DELETE — take back the request I have waiting. */
export const DELETE = route(async () => {
  const me = await requireUser(["CLIENT"]);
  await cancelMine(me);
  return NextResponse.json({ pending: null });
});
