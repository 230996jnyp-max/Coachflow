import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
/** POST { clientId, startDate, liveSync? } — give the program to a client (or to yourself when you train on your own). */
export const POST = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json(await P.assignProgram(me, id, body));
});
