import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { hashPassword, requireUser } from "@/lib/server/auth";
import { tempPassword } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { assertSameOrigin, notFound, route } from "@/lib/server/http";
import { users } from "@/lib/server/schema";
import { sendCredentialsEmail } from "@/lib/server/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — owner resets a coach's password. The new temporary password is emailed to the coach and shown once to the owner. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  await requireUser(["OWNER"]);
  const { id } = await ctx.params;
  const d = await db();
  const [row] = await d.select().from(users).where(and(eq(users.id, id), eq(users.role, "COACH"))).limit(1);
  if (!row) throw notFound("Coach not found.");
  const password = tempPassword();
  await d
    .update(users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, tokenVersion: row.tokenVersion + 1, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, id));
  const origin = process.env.APP_URL || new URL(req.url).origin;
  const mail = await sendCredentialsEmail({ to: row.email ?? row.username, name: row.name ?? row.username, username: row.username, password, origin, reset: true });
  return NextResponse.json({ temporaryPassword: password, email: { status: mail.status, error: mail.error } });
});
