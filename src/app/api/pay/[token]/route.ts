import { NextResponse } from "next/server";
import { assertSameOrigin, badRequest, readJson, route } from "@/lib/server/http";
import { claimPayNow, payByLink, publicOrder } from "@/lib/server/payments";
import { hit, ipTag } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** GET — what a pay link is for (coach, package, price). No account needed: the link itself is the secret. */
export const GET = route<Ctx>(async (req, ctx) => {
  await hit(`pay:${ipTag(req)}`, 120, 10 * 60_000);
  const { token } = await ctx.params;
  return NextResponse.json({ order: await publicOrder(token) });
});

/** POST { action: "card" } returns { url } (the Stripe page). { action: "paynow" } tells the coach the PayNow transfer was sent. */
export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  await hit(`pay:${ipTag(req)}`, 60, 10 * 60_000);
  const body = await readJson(req, 500);
  const { token } = await ctx.params;
  const origin = process.env.APP_URL || new URL(req.url).origin;
  if (body.action === "card") return NextResponse.json({ url: await payByLink(token, origin) });
  if (body.action === "paynow") {
    await claimPayNow(token);
    return NextResponse.json({ ok: true });
  }
  throw badRequest("Nothing to do.");
});
