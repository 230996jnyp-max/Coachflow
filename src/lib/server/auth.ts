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

export type DbRole = "OWNER" | "COACH" | "CLIENT";
export const isStaff = (u: Pick<UserRow, "role">) => u.role === "OWNER" || u.role === "COACH";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** Issues the httpOnly session cookie. `tokenVersion` lets us revoke every session (password change, deactivation). */
export async function createSession(user: UserRow) {
  const jwt = await new SignJWT({ tv: user.tokenVersion })
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
