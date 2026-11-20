import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json({ program: await P.getProgram(me, id), enrolments: (await P.listEnrolments(me)).filter((e) => e.programId === id) });
});

/** PUT { name?, description?, goal?, level?, weeks?, slots? } — save changes; clients on Live Sync are brought up to date. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req, 400_000);
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json(await P.updateProgram(me, id, body));
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await P.deleteProgram(me, id);
  return NextResponse.json({ ok: true });
});
