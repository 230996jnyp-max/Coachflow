import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { HttpError } from "./http";
import { aiUsage } from "./schema";

/** Today's date in Singapore, the day the daily limits roll over. */
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

/**
 * Counts one AI call for this person and refuses it once they have used `cap` today. The AI has a small shared free allowance, so
 * each kind of call is limited per person per day.
 */
export async function takeAiQuota(userId: string, kind: string, cap: number, what: string): Promise<void> {
  const d = await db();
  const [row] = await d
    .insert(aiUsage)
    .values({ userId, day: today(), kind, n: 1 })
    .onConflictDoUpdate({ target: [aiUsage.userId, aiUsage.day, aiUsage.kind], set: { n: sql`${aiUsage.n} + 1` } })
    .returning({ n: aiUsage.n });
  if (row.n > cap) throw new HttpError(429, `You've used today's ${cap} ${what}. Try again tomorrow.`);
}

/** Like takeAiQuota, but answers true / false instead of throwing (used where going over the limit just skips something). */
export async function tryAiQuota(userId: string, kind: string, cap: number): Promise<boolean> {
  try {
    await takeAiQuota(userId, kind, cap, "allowance");
    return true;
  } catch {
    return false;
  }
}
