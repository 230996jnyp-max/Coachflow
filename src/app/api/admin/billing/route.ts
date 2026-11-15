import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { billingOverview } from "@/lib/server/billing";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — owner only: subscribed coaches, active trials, monthly recurring revenue (SGD cents) and each coach's tier and renewal date. */
export const GET = route(async () => {
  await requireUser(["OWNER"]);
  return NextResponse.json(await billingOverview());
});
