import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, route } from "@/lib/server/http";
import { hit } from "@/lib/server/rateLimit";
import { sendPush } from "@/lib/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — sends a test notification to this person's own devices (quiet hours ignored: they asked for it). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(undefined, { skipBilling: true });
  await hit(`push-test:${me.id}`, 5, 600_000, "That's a lot of test notifications. Try again in a few minutes.");
  const reached = await sendPush([me.id], { title: "CoachFlow notifications are on", body: "This is a test. You will get alerts like this for bookings, messages and reminders.", url: "/notifications", tag: "push-test" }, { force: true });
  return NextResponse.json({ ok: true, reached });
});
