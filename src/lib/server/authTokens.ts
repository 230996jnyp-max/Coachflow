import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db";
import { authTokens } from "./schema";

/** "signup_wait": held only by the browser that signed up, so its waiting page can move on by itself once the email is confirmed. */
export type TokenKind = "verify" | "reset" | "signup_wait" | "delete";
const TTL_MS: Record<TokenKind, number> = { verify: 48 * 3_600_000, reset: 60 * 60_000, signup_wait: 48 * 3_600_000, delete: 60 * 60_000 };

const hashOf = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** A fresh one-time token for `userId` (any older unused one of the same kind stops working). Only the hash is stored. */
export async function issueToken(userId: string, kind: TokenKind): Promise<string> {
  const d = await db();
  await d.update(authTokens).set({ usedAt: new Date() }).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)));
  const raw = randomBytes(32).toString("base64url");
  await d.insert(authTokens).values({ id: `tk_${randomUUID()}`, userId, kind, tokenHash: hashOf(raw), expiresAt: new Date(Date.now() + TTL_MS[kind]) });
  return raw;
}

/** Looks the token up without using it (for a screen that wants to know whether the link is still good). */
export async function peekToken(raw: string, kind: TokenKind): Promise<string | null> {
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 100) return null;
  const d = await db();
  const [row] = await d
    .select({ userId: authTokens.userId })
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hashOf(raw)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1);
  return row?.userId ?? null;
}

/** Uses the token up. Returns whose it was, or null when it is unknown, already used or expired. Two people can't both use one token. */
export async function consumeToken(raw: string, kind: TokenKind): Promise<string | null> {
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 100) return null;
  const d = await db();
  const [row] = await d
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, hashOf(raw)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning({ userId: authTokens.userId });
  return row?.userId ?? null;
}
