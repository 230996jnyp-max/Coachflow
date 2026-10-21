import { NextResponse } from "next/server";
import { createSession, requireUser } from "@/lib/server/auth";
import { assertSameOrigin, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — the browser reports real user activity (clicks, typing, scrolling); this restarts the 4-hour inactivity clock. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(); // 401 if the session already timed out
  await createSession(me);
  return NextResponse.json({ ok: true });
});
