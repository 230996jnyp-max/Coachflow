import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { respondToMove } from "@/lib/server/gymCover";
import { badRequest, forbidden, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { accept: boolean } — the client's answer to a gym's request to move them to another coach. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const body = await readJson(req, 500);
  const me = await requireUser();
  if (me.role !== "CLIENT") throw forbidden("Only the client can answer this.");
  if (typeof body.accept !== "boolean") throw badRequest("Say whether you agree.");
  const { id } = await ctx.params;
  return NextResponse.json({ ok: true, ...(await respondToMove(me, id, body.accept)) });
});
