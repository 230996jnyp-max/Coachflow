import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { isUniqueViolation } from "./http";
import { users, type UserRow } from "./schema";

/** A random six-digit code (100000 to 999999). */
export const randomCoachCode = (): string => String(randomInt(100_000, 1_000_000));

/** Gives a coach (or the owner) a unique code if they have none yet, and returns it. Safe to call on every load. */
export async function ensureCoachCode(row: UserRow): Promise<string | null> {
  if (row.role !== "COACH" && row.role !== "OWNER") return null;
  if (row.coachCode) return row.coachCode;
  const d = await db();
  for (let i = 0; i < 25; i++) {
    const code = randomCoachCode();
    try {
      const [done] = await d.update(users).set({ coachCode: code, updatedAt: new Date() }).where(and(eq(users.id, row.id), isNull(users.coachCode))).returning({ code: users.coachCode });
      if (done?.code) return done.code;
      // Someone (another tab) set it first: use theirs.
      const [now] = await d.select({ code: users.coachCode }).from(users).where(eq(users.id, row.id)).limit(1);
      if (now?.code) return now.code;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // that code was taken: try another
    }
  }
  throw new Error("Could not make a coach code");
}

/** The active coach (or owner) with this code, or null. */
export async function coachByCode(code: string): Promise<UserRow | null> {
  const d = await db();
  const [row] = await d
    .select()
    .from(users)
    .where(and(eq(users.coachCode, code), inArray(users.role, ["COACH", "OWNER"]), eq(users.active, true)))
    .limit(1);
  return row ?? null;
}
