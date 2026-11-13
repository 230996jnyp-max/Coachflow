import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, readJson, route } from "@/lib/server/http";
import { buyAsClient, createPayLink, recordManual } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — a client buys a package: { packageId } returns { url } (the Stripe page). A coach makes a pay link: { clientId, packageId }
 * returns { order, path }, or records a payment they received themselves: { clientId, manual: true, packageId | name, sessions,
 * groupCredits, price, kind, note }.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = await readJson(req, 6_000);
  const me = await requireUser();
  const origin = process.env.APP_URL || new URL(req.url).origin;
  if (me.role === "CLIENT") return NextResponse.json(await buyAsClient(me, body.packageId, origin));
  if (body.manual === true) return NextResponse.json({ order: await recordManual(me, body) });
  return NextResponse.json(await createPayLink(me, body.clientId, body.packageId));
});
