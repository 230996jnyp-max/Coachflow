import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { loadClientFor } from "@/lib/server/accounts";
import { hashPassword, requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { checkPassword, notFound, readJson, route } from "@/lib/server/http";
import { users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { password } — a coach sets a new temporary password for their client (forces a change at next login). */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  const row = await loadClientFor(me, id);
  if (!row) throw notFound("Client not found.");
  const password = checkPassword(body.password, "Temporary password");
  const d = await db();
  await d
    .update(users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, tokenVersion: row.tokenVersion + 1, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, id));
  return NextResponse.json({ ok: true });
});
