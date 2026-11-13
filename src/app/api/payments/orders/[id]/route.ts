import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, badRequest, readJson, route } from "@/lib/server/http";
import { cancelOrder, confirmReceived, refundOrder } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { action: "refund" | "confirm" | "cancel" } — a coach refunds a payment in full, confirms a PayNow they received, or cancels a link. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  const body = await readJson(req, 1_000);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  if (body.action === "refund") return NextResponse.json({ order: await refundOrder(me, id) });
  if (body.action === "confirm") return NextResponse.json({ order: await confirmReceived(me, id) });
  if (body.action === "cancel") {
    await cancelOrder(me, id);
    return NextResponse.json({ ok: true });
  }
  throw badRequest("Nothing to do.");
});
