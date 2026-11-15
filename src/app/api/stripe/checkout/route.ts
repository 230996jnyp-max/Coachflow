import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { startCheckout } from "@/lib/server/billing";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST — a coach starts Stripe Checkout for their subscription (what is left of the free trial carries over). Answers { url }. */
export const POST = route(async (req) => {
  const me = await requireUser(["OWNER", "COACH"], { skipBilling: true });
  const url = await startCheckout(me, process.env.APP_URL || new URL(req.url).origin);
  return NextResponse.json({ url });
});
