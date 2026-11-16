import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { buyOptions, listForClient, listForCoach, listPackages, paymentState } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET [?refresh=1] — a coach: their payment setup (Stripe, PayNow), packages, payments and totals. A client: what they can buy from
 * their coach (nothing if their coach has not switched payments on) and their own payment history.
 */
export const GET = route(async (req) => {
  const me = await requireUser();
  if (me.role === "CLIENT") return NextResponse.json({ options: await buyOptions(me), orders: await listForClient(me) });
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const { orders, totals } = await listForCoach(me);
  return NextResponse.json({ state: await paymentState(me, { refresh }), packages: await listPackages(me.id), orders, totals });
});
