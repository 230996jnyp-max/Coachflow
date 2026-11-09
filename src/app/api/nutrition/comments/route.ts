import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { addComment, subjectFor } from "@/lib/server/nutrition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { clientId, day, text } - a coach comments on one day of their client's food diary; the client is notified. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const subject = await subjectFor(me, body.clientId);
  return NextResponse.json({ comment: await addComment(me, subject, body.day, body.text) });
});
