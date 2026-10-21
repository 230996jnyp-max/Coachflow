import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { assertSameOrigin, route } from "@/lib/server/http";
import { slots } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  const d = await db();
  await d.delete(slots).where(and(eq(slots.id, id), eq(slots.coachId, me.id)));
  return NextResponse.json({ ok: true });
});
