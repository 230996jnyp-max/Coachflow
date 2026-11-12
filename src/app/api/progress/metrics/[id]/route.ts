import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { putMetric, removeMetric } from "@/lib/server/bodyData";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT { metric } — save one body check-in (`?mode=insert-only` when a device uploads what it kept locally: never changes an existing one). */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  const m = body.metric as { id?: unknown } | undefined;
  if (!m || m.id !== id) throw badRequest("Check-in does not match the address.");
  const mode = new URL(req.url).searchParams.get("mode") === "insert-only" ? "insert-only" : "upsert";
  await putMetric(me, m, mode);
  return NextResponse.json({ ok: true });
});

/** DELETE — remove a check-in (its client, or that client's coach). */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await removeMetric(me, id);
  return NextResponse.json({ ok: true });
});
