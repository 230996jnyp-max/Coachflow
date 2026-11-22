import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { forbidden, readJson, route, assertSameOrigin, badRequest } from "@/lib/server/http";
import { membershipOf } from "@/lib/server/gymOrg";
import { gymPlanView, openGymPortal, requestCustomPlan, startGymCheckout } from "@/lib/server/gymPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The gym's owner only. These routes skip the billing pause on purpose: a paused gym's owner must be able to subscribe or pay. */
async function owner() {
  const me = await requireUser(["OWNER", "COACH"], { skipBilling: true });
  const m = await membershipOf(me.id);
  if (!m || m.member.status !== "ACTIVE" || !m.isOwner || m.gym.status !== "ACTIVE") throw forbidden("Only the gym's owner can see or change its billing.");
  return { me, gym: m.gym };
}

/** GET — the gym's plan: free month, price, subscription, grace period, and whether it needs a custom plan. */
export const GET = route(async () => {
  const { gym } = await owner();
  return NextResponse.json(await gymPlanView(gym));
});

/** POST { action: "checkout" | "portal" | "request-plan", note? } — subscribe on Stripe's own page, manage the card, or ask for a custom price. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = await readJson(req);
  const { me, gym } = await owner();
  const origin = process.env.APP_URL || new URL(req.url).origin;
  if (body.action === "checkout") return NextResponse.json({ url: await startGymCheckout(me, gym, origin) });
  if (body.action === "portal") return NextResponse.json({ url: await openGymPortal(gym, origin) });
  if (body.action === "request-plan") {
    await requestCustomPlan(me, gym, body.note);
    return NextResponse.json({ ok: true });
  }
  throw badRequest("Unknown action.");
});
