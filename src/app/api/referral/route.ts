import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, forbidden, readJson, route } from "@/lib/server/http";
import { referralSummary, setClientReward } from "@/lib/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — the signed-in person's own invitation code and link, and how the people they invited are getting on. Coaches, clients and people
 * training on their own each have one (the kind decides who can use it and what it earns).
 */
export const GET = route(async (req) => {
  const me = await requireUser(undefined, { skipBilling: true });
  return NextResponse.json(await referralSummary(me, process.env.APP_URL || new URL(req.url).origin));
});

/** PUT { clientRewardCredits } — a coach chooses how many session credits a client earns when a friend they invited joins (0 = off). */
export const PUT = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(["OWNER", "COACH"], { skipBilling: true });
  if (me.role === "CLIENT") throw forbidden("Only a coach can change this.");
  const body = await readJson(req);
  const credits = await setClientReward(me, body.clientRewardCredits);
  return NextResponse.json({ clientReward: credits });
});
