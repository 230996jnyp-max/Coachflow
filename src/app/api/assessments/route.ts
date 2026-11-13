import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { createAssessment, listAssessments } from "@/lib/server/assessments";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET [?clientId=] — a coach: every assessment of one of their clients. A client: their own, and the coach's they were given a copy of. */
export const GET = route(async (req) => {
  const me = await requireUser();
  const clientId = me.role === "CLIENT" ? me.id : (new URL(req.url).searchParams.get("clientId") ?? "");
  if (!clientId) throw badRequest("Choose a client.");
  return NextResponse.json({ assessments: await listAssessments(me, clientId) });
});

/** POST [{ clientId }] — start an assessment (a coach for a client; a client for themselves). Items the coach wrote under "Others" last time are listed again. */
export const POST = route(async (req) => {
  const body = await readJson(req, 2_000);
  const me = await requireUser();
  return NextResponse.json({ assessment: await createAssessment(me, typeof body.clientId === "string" ? body.clientId : undefined) });
});
