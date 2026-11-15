import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { acknowledgeAssessment, deleteAssessment, getAssessment, saveAssessment, shareAssessment } from "@/lib/server/assessments";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json({ assessment: await getAssessment(me, id) });
});

/** PUT { data, finish? } — save what was filled in (and finish it). A client's finished one tells their coach. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req, 100_000);
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json({ assessment: await saveAssessment(me, id, body.data, { finish: body.finish === true }) });
});

/** PATCH { share: boolean } — the coach gives the client a copy (or takes it back). { acknowledge: true } — the client acknowledges their copy. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req, 2_000);
  const me = await requireUser();
  const { id } = await ctx.params;
  if (body.acknowledge === true) await acknowledgeAssessment(me, id);
  else if (typeof body.share === "boolean") await shareAssessment(me, id, body.share);
  else throw badRequest("Nothing to change.");
  return NextResponse.json({ ok: true, assessment: await getAssessment(me, id) });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await deleteAssessment(me, id);
  return NextResponse.json({ ok: true });
});
