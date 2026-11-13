import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { deletePhoto, getAssessment, putPhoto, readPhoto } from "@/lib/server/assessments";
import { readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; view: string }> };

/** GET — a posture photo, only for the coach and the client it belongs to (and for the client, only of an assessment they can see). */
export const GET = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id, view } = await ctx.params;
  const p = await readPhoto(me, id, view);
  return new Response(new Uint8Array(p.bytes), { headers: { "Content-Type": p.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});

/** PUT { mime, data } — add or replace the front, side or back photo of an assessment (already shrunk by the browser). */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req, 1_200_000);
  const me = await requireUser();
  const { id, view } = await ctx.params;
  await putPhoto(me, id, view, body.mime, body.data);
  return NextResponse.json({ ok: true, assessment: await getAssessment(me, id) });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id, view } = await ctx.params;
  await deletePhoto(me, id, view);
  return NextResponse.json({ ok: true, assessment: await getAssessment(me, id) });
});
