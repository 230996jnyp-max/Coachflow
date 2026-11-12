import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { removeReply, updateReply } from "@/lib/server/savedReplies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { title, text } — change a saved reply. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  return NextResponse.json({ replies: await updateReply(me, id, body) });
});

/** DELETE — remove a saved reply. */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  return NextResponse.json({ replies: await removeReply(me, id) });
});
