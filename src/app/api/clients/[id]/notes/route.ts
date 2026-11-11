import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { addNote, listNotes, removeNote } from "@/lib/server/clientNotes";
import { readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET — this coach's private notes about one of their clients (newest first). Clients never get these. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  return NextResponse.json({ notes: await listNotes(me, id) });
});

/** POST { text } — add a note. */
export const POST = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  return NextResponse.json({ notes: await addNote(me, id, body.text) });
});

/** DELETE ?note=<id> — remove a note. */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  const noteId = new URL(req.url).searchParams.get("note") ?? "";
  return NextResponse.json({ notes: await removeNote(me, id, noteId) });
});
