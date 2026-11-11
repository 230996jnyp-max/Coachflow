import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { addComment, removeComment, talkFor, toggleReaction } from "@/lib/server/workoutTalk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET — the comments and 👍 / 🔥 reactions under one workout (only its client and that client's coach). */
export const GET = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json(await talkFor(me, id));
});

/** POST { text } — add a comment. */
export const POST = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json(await addComment(me, id, body.text));
});

/** PUT { emoji } — switch a 👍 or 🔥 on or off. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json(await toggleReaction(me, id, body.emoji));
});

/** DELETE ?comment=<id> — remove a comment (the author, or the client's coach). */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const commentId = new URL(req.url).searchParams.get("comment") ?? "";
  return NextResponse.json(await removeComment(me, id, commentId));
});
