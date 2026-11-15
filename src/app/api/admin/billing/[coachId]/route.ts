import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { setExempt } from "@/lib/server/billing";
import { badRequest, notFound, readJson, route } from "@/lib/server/http";
import { db } from "@/lib/server/db";
import { users } from "@/lib/server/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ coachId: string }> };

/** POST { exempt } — the owner turns "Exempt / Beta Lifetime Access" on or off for a coach. The owner themself is always exempt. */
export const POST = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  await requireUser(["OWNER"]);
  const { coachId } = await ctx.params;
  if (typeof body.exempt !== "boolean") throw badRequest("exempt must be true or false.");
  const d = await db();
  const [coach] = await d.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, coachId)).limit(1);
  if (!coach || coach.role === "CLIENT") throw notFound("Coach not found.");
  if (coach.role === "OWNER" && !body.exempt) throw badRequest("The owner always has free lifetime access.");
  await setExempt(coachId, body.exempt);
  return NextResponse.json({ ok: true });
});
