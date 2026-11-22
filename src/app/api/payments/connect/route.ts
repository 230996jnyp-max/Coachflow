import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, route } from "@/lib/server/http";
import { disconnect, paymentState, startConnect } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — a coach starts (or resumes) connecting their own Stripe account. Returns the Stripe page to continue on. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const origin = process.env.APP_URL || new URL(req.url).origin;
  return NextResponse.json({ url: await startConnect(me, origin) });
});

/** DELETE — forget the link to the coach's Stripe account here (the Stripe account itself is untouched). */
export const DELETE = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(["OWNER", "COACH"]);
  await disconnect(me);
  return NextResponse.json({ state: await paymentState(me) });
});
