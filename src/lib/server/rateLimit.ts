import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { db } from "./db";
import { tooMany } from "./http";
import { rateEvents } from "./schema";

/** A stable, non-reversible tag for the caller's network address (the raw address is never stored). */
export function ipTag(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}|rate|${ip}`).digest("hex").slice(0, 24);
}

/** Throws 429 when `key` already has `limit` events in the window, without counting this call (pair with `record`). */
export async function assertBelow(key: string, limit: number, windowMs: number, message?: string): Promise<void> {
  const d = await db();
  const since = new Date(Date.now() - windowMs);
  const [r] = await d.select({ n: count() }).from(rateEvents).where(and(eq(rateEvents.key, key), gt(rateEvents.at, since)));
  if (Number(r.n) >= limit) throw tooMany(message ?? "Too many attempts. Please wait a while and try again.");
}

/** Counts one event against `key` (for example a failed sign-in). */
export async function record(key: string): Promise<void> {
  const d = await db();
  await d.insert(rateEvents).values({ id: `re_${randomUUID()}`, key });
}

/**
 * Counts one event against `key` and refuses (429) once `limit` events happened within `windowMs`. Refused attempts are not counted,
 * so waiting out the window always works. Old events are removed as they are read.
 */
export async function hit(key: string, limit: number, windowMs: number, message?: string): Promise<void> {
  const d = await db();
  const since = new Date(Date.now() - windowMs);
  const [r] = await d
    .select({ n: count() })
    .from(rateEvents)
    .where(and(eq(rateEvents.key, key), gt(rateEvents.at, since)));
  if (Number(r.n) >= limit) throw tooMany(message ?? "Too many attempts. Please wait a while and try again.");
  await d.insert(rateEvents).values({ id: `re_${randomUUID()}`, key });
  // Tidy: rows older than a day belong to no window we use.
  if (Math.random() < 0.05) await d.delete(rateEvents).where(lt(rateEvents.at, new Date(Date.now() - 86_400_000)));
}
