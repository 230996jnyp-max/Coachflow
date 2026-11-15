import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { acknowledgeForm, reviewForm } from "@/lib/server/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH — a coach reviews a form: { note?, share? } (share, on by default, gives the client a copy with the note to read).
 * A client acknowledges a copy they were given: { acknowledge: true }.
 */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const body = await readJson(req, 5_000);
  const me = await requireUser();
  const { id } = await ctx.params;
  if (me.role === "CLIENT") {
    if (body.acknowledge !== true) throw badRequest("Nothing to change.");
    await acknowledgeForm(me, id);
  } else await reviewForm(me, id, { note: body.note, share: body.share });
  return NextResponse.json({ ok: true });
});
