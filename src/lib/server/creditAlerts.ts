import "server-only";
import { and, eq } from "drizzle-orm";
import { openProfile } from "./accounts";
import { db } from "./db";
import { notify } from "./groups";
import { users } from "./schema";
import { balanceOf, type Pool } from "./credits";
import { daysUntil, expiryWhen, todayIn } from "@/lib/packageExpiry";

/*
 * Package alerts, the two moments a coach would otherwise have to spot by eye:
 *  - a client's sessions running low ("1 session left", "no sessions left"): sent right when a credit is taken and the balance crosses
 *    down to 1 or 0, to the client (with the coach's name, so it reads as a nudge to top up) and to the coach;
 *  - a package that is about to run out of time (see packageExpiryAlerts): a week before and the day before, only while sessions remain.
 * Both only ever say something once per threshold, so a busy week doesn't turn into a stream of notices.
 */

/**
 * Call after a credit was taken from a client (`taken` = how many). When that moved their balance down to 1 or 0, tell them and their coach.
 * Never throws: an alert must not break marking attendance.
 */
export async function lowCreditAfter(clientId: string, coachId: string, pool: Pool, taken: number): Promise<void> {
  if (taken <= 0) return;
  try {
    // The same "Credits left" number the coach sees on the client page.
    const after = await balanceOf(clientId, pool);
    if (after > 1) return;
    const d = await db();
    const [client] = await d.select().from(users).where(eq(users.id, clientId)).limit(1);
    const [coach] = await d.select().from(users).where(and(eq(users.id, coachId))).limit(1);
    if (!client || !coach) return;
    const name = openProfile(client).name.trim() || "Your client";
    const first = name.split(/\s+/)[0];
    const what = pool === "GROUP" ? "group class credit" : "session";
    const left = after === 1 ? `1 ${what} left` : `no ${what}s left`;
    await notify(
      [clientId],
      "credits_low",
      { title: after === 1 ? `Only 1 ${what} left` : `You're out of ${what}s`, body: `You have ${left} in your package. Message ${coach.name ?? "your coach"} to top up so your next booking isn't held up.`, link: "/book" },
      { email: true },
    );
    await notify([coachId], "credits_low", { title: after === 1 ? `${first} has 1 ${what} left` : `${first} is out of ${what}s`, body: `${name} has ${left}. A good moment to offer a new package.`, link: `/clients/${clientId}` }, { email: false });
  } catch (e) {
    console.error("low credit alert failed", e);
  }
}

/**
 * The daily job: for every client whose package still has sessions and ends in 7 days or tomorrow, tell the client and their coach.
 * Run once a day, so each threshold is hit exactly once.
 */
export async function packageExpiryAlerts(now = new Date()): Promise<{ checked: number; alerted: number }> {
  const d = await db();
  const rows = await d.select().from(users).where(and(eq(users.role, "CLIENT"), eq(users.active, true)));
  const today = todayIn(process.env.APP_TZ || undefined, now);
  let checked = 0;
  let alerted = 0;
  for (const row of rows) {
    if (!row.coachId) continue;
    let p;
    try {
      p = openProfile(row);
    } catch {
      continue;
    }
    if (!p.packageExpires) continue;
    checked++;
    const left = daysUntil(p.packageExpires, today);
    const when = expiryWhen(left);
    if (!when) continue;
    const sessions = p.credits;
    const groups = p.groupClassCredits ?? 0;
    if (sessions + groups <= 0) continue;
    const name = p.name.trim() || "Your client";
    const first = name.split(/\s+/)[0];
    const remaining = [sessions > 0 ? `${sessions} session${sessions === 1 ? "" : "s"}` : "", groups > 0 ? `${groups} group class credit${groups === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    await notify([row.id], "package_expiring", { title: left === 1 ? "Your package ends tomorrow" : "Your package ends in a week", body: `Your package expires ${when} and you still have ${remaining}. Book them in before then, or ask your coach about extending it.`, link: "/book" }, { email: true });
    await notify([row.coachId], "package_expiring", { title: `${first}'s package ends ${when}`, body: `${name} still has ${remaining} that expire ${when}.`, link: `/clients/${row.id}` }, { email: false });
    alerted++;
  }
  return { checked, alerted };
}
