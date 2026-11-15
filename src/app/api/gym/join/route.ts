import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { joinWithCode, leaveGym } from "@/lib/server/gymOrg";
import { readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { code } — a coach links to a gym with its 6-digit code (waits for approval unless they were invited). */
export const POST = route(async (req) => {
  const body = await readJson(req, 500);
  const me = await requireUser(["COACH"]);
  return NextResponse.json(await joinWithCode(me, body.code));
});

/** DELETE — leave the gym, or withdraw a request. Your clients and account are untouched. */
export const DELETE = route(async () => {
  const me = await requireUser(["COACH"]);
  await leaveGym(me);
  return NextResponse.json({ ok: true });
});
