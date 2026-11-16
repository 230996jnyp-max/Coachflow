import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, badRequest, readJson, route } from "@/lib/server/http";
import { deviceCount, parseSubscription, pushConfigured, removePushSubscription, savePushSubscription, vapidPublicKey } from "@/lib/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — whether this server can send push, the public key the browser needs to subscribe, and how many of this person's devices are on. */
export const GET = route(async () => {
  const me = await requireUser(undefined, { skipBilling: true });
  return NextResponse.json({ configured: pushConfigured(), publicKey: vapidPublicKey(), devices: await deviceCount(me.id) });
});

/** POST { subscription } — this device turns phone notifications on. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(undefined, { skipBilling: true });
  if (!pushConfigured()) throw badRequest("Phone notifications aren't set up on this server yet.");
  const body = await readJson(req);
  await savePushSubscription(me, parseSubscription(body.subscription), req.headers.get("user-agent"));
  return NextResponse.json({ ok: true, devices: await deviceCount(me.id) });
});

/** DELETE { endpoint } — this device turns phone notifications off. */
export const DELETE = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(undefined, { skipBilling: true });
  const body = await readJson(req);
  if (typeof body.endpoint !== "string" || !body.endpoint) throw badRequest("Which device?");
  await removePushSubscription(me, body.endpoint);
  return NextResponse.json({ ok: true, devices: await deviceCount(me.id) });
});
