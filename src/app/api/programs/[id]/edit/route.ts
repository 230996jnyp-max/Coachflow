import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };
/** POST { instruction } — a chat edit ("make week 3 easier"); POST { undo: true } — put the program back as it was before the last chat edit. */
export const POST = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  if (body.undo === true) return NextResponse.json({ program: await P.undoEdit(me, id), notes: [], skipped: [] });
  return NextResponse.json(await P.editWithAi(me, id, body.instruction));
});
