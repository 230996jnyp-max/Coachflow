import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createSession, hashPassword, requireUser, verifyPassword } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { badRequest, checkPassword, readJson, route } from "@/lib/server/http";
import { users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { current, next } — change your own password. Revokes every other session. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(undefined, { skipBilling: true });
  const current = typeof body.current === "string" ? body.current : "";
  const next = checkPassword(body.next, "New password");
  if (!(await verifyPassword(current, me.passwordHash))) throw badRequest("Current password is incorrect.");
  if (next === current) throw badRequest("New password must differ from the current one.");

  const d = await db();
  const [updated] = await d
    .update(users)
    .set({ passwordHash: await hashPassword(next), mustChangePassword: false, tokenVersion: me.tokenVersion + 1, updatedAt: new Date() })
    .where(eq(users.id, me.id))
    .returning();
  await createSession(updated); // keep this browser signed in under the new token version
  return NextResponse.json({ ok: true });
});
