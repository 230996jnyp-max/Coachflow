import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { resolveReport } from "@/lib/server/consult";
import { assertSameOrigin, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { refund: none | partial | full, refundCents?, sanction, note? } — the platform owner decides a consult report. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  const body = await readJson(req);
  const me = await requireUser(["OWNER"]);
  const { id } = await ctx.params;
  await resolveReport(me, id, body);
  return NextResponse.json({ ok: true });
});
