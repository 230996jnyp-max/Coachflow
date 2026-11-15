import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { billingInfo } from "@/lib/server/billing";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the signed-in person's billing: trial days, tier, renewal, and whether they (or their coach) are paused. Always answers, even when paused. */
export const GET = route(async () => {
  const me = await requireUser(undefined, { skipBilling: true });
  return NextResponse.json(await billingInfo(me));
});
