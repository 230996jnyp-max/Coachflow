import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { putTemplate, removeTemplate } from "@/lib/server/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT { template } — create or replace one of the caller's own routine templates. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  const t = body.template as { id?: unknown } | undefined;
  if (!t || t.id !== id) throw badRequest("Template does not match the address.");
  await putTemplate(me, t);
  return NextResponse.json({ ok: true });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await removeTemplate(me, id);
  return NextResponse.json({ ok: true });
});
