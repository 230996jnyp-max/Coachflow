import "server-only";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";
import { forbidden, unauthorized } from "./http";
import { users, type UserRow } from "./schema";

const COOKIE = "cf_session";
const MAX_AGE = 7 * 24 * 60 * 60;
/** A session with no real user activity for this long is dead, even if the cookie is still valid. */
export const IDLE_SECONDS = 4 * 60 * 60;

export type DbRole = "OWNER" | "COACH" | "CLIENT";
export const isStaff = (u: Pick<UserRow, "role">) => u.role === "OWNER" || u.role === "COACH";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

/*
 * Passwords are hashed with Argon2id (the OWASP-recommended algorithm), using more memory than OWASP's minimum (19 MiB, 2 passes):
 * 46 MiB and 2 passes, which is stronger against GPU / ASIC cracking than the bcrypt cost-12 it replaces, and about five times
 * quicker to check. Older bcrypt hashes keep working and are upgraded the next time that person signs in. If the native Argon2
 * module can't load in some environment, hashing falls back to bcrypt so signing in never breaks.
 */
const ARGON = { memoryCost: 47104, timeCost: 2, parallelism: 1 } as const;
let argonModule: Promise<typeof import("@node-rs/argon2") | null> | undefined;
const argon = () => (argonModule ??= import("@node-rs/argon2").catch(() => null));

export async function hashPassword(plain: string): Promise<string> {
  const a = await argon();
  return a ? a.hash(plain, ARGON) : bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (hash.startsWith("$argon2")) {
    const a = await argon();
    if (!a) return false;
    try {
      return await a.verify(hash, plain);
    } catch {
      return false;
    }
  }
  return bcrypt.compare(plain, hash);
}

/** An older bcrypt hash that should be replaced with an Argon2id one after a successful sign-in. */
export const needsRehash = async (hash: string): Promise<boolean> => !hash.startsWith("$argon2") && (await argon()) !== null;

/** Issues the httpOnly session cookie. `tokenVersion` lets us revoke every session (password change, deactivation). */
export async function createSession(user: UserRow) {
  // `la` = last activity. Background polling never refreshes it; only the explicit activity ping and logging in do.
  const jwt = await new SignJWT({ tv: user.tokenVersion, la: Math.floor(Date.now() / 1000) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

/** The signed-in user (fresh from the database), or null. */
export async function currentUser(): Promise<UserRow | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const d = await db();
    const [row] = await d.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!row || !row.active || row.tokenVersion !== payload.tv) return null;
    // Sessions issued before inactivity tracking have no `la`; their issue time stands in for it.
    const lastActive = typeof payload.la === "number" ? payload.la : (payload.iat ?? 0);
    if (Date.now() / 1000 - lastActive > IDLE_SECONDS) return null;
    return row;
  } catch {
    return null;
  }
}

/** Requires a signed-in user, optionally restricted to certain roles. */
export async function requireUser(roles?: DbRole[]): Promise<UserRow> {
  const u = await currentUser();
  if (!u) throw unauthorized();
  if (roles && !roles.includes(u.role as DbRole)) throw forbidden();
  return u;
}
