import { eq, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createSession, hashPassword, needsRehash, verifyPassword } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { HttpError, readJson, route, str } from "@/lib/server/http";
import { assertBelow, ipTag, record } from "@/lib/server/rateLimit";
import { users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const FAIL = "Incorrect username or password, or the account is deactivated.";
/** One network address may get this many sign-ins wrong in ten minutes (across all accounts) before it has to wait. */
const IP_FAILS = 25;
const IP_WINDOW_MS = 10 * 60 * 1000;

// A real bcrypt hash of a random string, used so unknown usernames take as long as known ones.
let dummyHash: Promise<string> | undefined;

export const POST = route(async (req) => {
  const body = await readJson(req);
  const username = str(body.username, "Username", { max: 200 }).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || password.length > 200) throw new HttpError(401, FAIL);

  const ip = ipTag(req);
  await assertBelow(`login-fail:${ip}`, IP_FAILS, IP_WINDOW_MS, "Too many failed sign-ins from this connection. Please wait a few minutes and try again.");

  const d = await db();
  // Staff can sign in with their username or their email; clients use their username.
  const [user] = await d
    .select()
    .from(users)
    .where(or(eq(users.username, username), sql`lower(${users.email}) = ${username}`))
    .orderBy(sql`(${users.username} = ${username}) DESC`)
    .limit(1);

  if (!user) {
    dummyHash ??= hashPassword(Math.random().toString(36));
    await verifyPassword(password, await dummyHash);
    await record(`login-fail:${ip}`);
    throw new HttpError(401, FAIL);
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new HttpError(429, "Too many failed attempts. Try again in 15 minutes.");
  }

  const ok = await verifyPassword(password, user.passwordHash);
  // The right password on an account the owner disabled: say so (and where to ask), instead of the generic message.
  if (ok && !user.active && user.disabledAt) throw new HttpError(403, "This account has been disabled. Please contact c.darshstrength@gmail.com.", "disabled");
  if (!ok || !user.active) {
    if (!ok) {
      await record(`login-fail:${ip}`);
      const fails = user.failedAttempts + 1;
      await d
        .update(users)
        .set(fails >= MAX_FAILS ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { failedAttempts: fails })
        .where(eq(users.id, user.id));
    }
    throw new HttpError(401, FAIL);
  }

  // Someone who signed themselves up must open the link in their confirmation email first (the right password proves it's them asking).
  if (!user.emailVerified) throw new HttpError(403, "Please confirm your email first: open the link we sent you. Didn't get it? Resend it below.", "unverified");

  const upgrade = (await needsRehash(user.passwordHash)) ? { passwordHash: await hashPassword(password) } : {};
  await d.update(users).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), ...upgrade }).where(eq(users.id, user.id));
  // Only an explicit "Stay signed in on this device" makes a longer session; every other sign-in is the normal 4-hour-idle one.
  await createSession(user, { remember: body.remember === true });
  return NextResponse.json({ ok: true });
});
