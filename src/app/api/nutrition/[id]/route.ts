import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { removeEntry, updateEntry } from "@/lib/server/nutrition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT { entry } - changes one of the signed-in person's own food entries. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  if (!body.entry) throw badRequest("Nothing to save.");
  return NextResponse.json({ entry: await updateEntry(me, id, body.entry) });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await removeEntry(me, id);
  return NextResponse.json({ ok: true });
});
