import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { addReply, addStarters, listReplies } from "@/lib/server/savedReplies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the coach's saved replies. */
export const GET = route(async () => {
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json({ replies: await listReplies(me) });
});

/** POST { title, text } — add one. POST { starters: true } — add the starter set (skipping any already there). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json({ replies: body.starters === true ? await addStarters(me) : await addReply(me, body) });
});
