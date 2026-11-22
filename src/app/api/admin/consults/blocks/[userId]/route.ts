import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { unblock } from "@/lib/server/consult";
import { assertSameOrigin, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE — the platform owner lifts a consult suspension (trainer) or block (person). */
export const DELETE = route<{ params: Promise<{ userId: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  const me = await requireUser(["OWNER"]);
  const { userId } = await ctx.params;
  await unblock(me, userId);
  return NextResponse.json({ ok: true });
});
