import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { forbidden, route } from "@/lib/server/http";
import { referralSummary } from "@/lib/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — a coach's own referral code and link, and how the coaches they invited are getting on. */
export const GET = route(async (req) => {
  const me = await requireUser(undefined, { skipBilling: true });
  if (me.role !== "COACH" && me.role !== "OWNER") throw forbidden("Only coaches have a referral code.");
  return NextResponse.json(await referralSummary(me, process.env.APP_URL || new URL(req.url).origin));
});
