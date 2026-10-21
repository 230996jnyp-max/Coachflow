import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { badRequest, notFound, readJson, route } from "@/lib/server/http";
import { users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { active } — owner activates/deactivates a coach (a deactivated coach is signed out immediately). */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER"]);
  const { id } = await ctx.params;
  if (typeof body.active !== "boolean") throw badRequest("active must be true or false.");
  if (id === me.id) throw badRequest("You can't deactivate your own owner account.");
  const d = await db();
  const [row] = await d.select().from(users).where(and(eq(users.id, id), eq(users.role, "COACH"))).limit(1);
  if (!row) throw notFound("Coach not found.");
  await d
    .update(users)
    .set({ active: body.active, tokenVersion: row.tokenVersion + 1, updatedAt: new Date() })
    .where(eq(users.id, id));
  return NextResponse.json({ ok: true });
});
