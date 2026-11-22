import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { openPortal } from "@/lib/server/billing";
import { assertSameOrigin, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST — opens Stripe's customer portal (update the card, see invoices, cancel). Answers { url }. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(["OWNER", "COACH"], { skipBilling: true });
  const url = await openPortal(me, process.env.APP_URL || new URL(req.url).origin);
  return NextResponse.json({ url });
});
