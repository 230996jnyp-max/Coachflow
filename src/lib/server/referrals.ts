import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { addDays } from "@/lib/billing";
import { cleanReferralCode, makeReferralCode, referralLink, REFERRAL_BONUS_DAYS, REFERRAL_MAX_REWARDS, type ReferralStatus } from "@/lib/referral";
import { ensureBilling, forgetBillingCache, stripe } from "./billing";
import { db } from "./db";
import { notify } from "./groups";
import { isUniqueViolation } from "./http";
import { coachBilling, referrals, users, type ReferralRow, type UserRow } from "./schema";

/*
 * Coach referrals (the rules are in lib/referral.ts).
 *  - A new coach who signs up with a code gets REFERRAL_BONUS_DAYS extra on their free trial, straight away (see signup.ts).
 *  - When that coach becomes a paying subscriber (Stripe says the subscription is "active": the first real payment went through), the
 *    coach who invited them gets one free month: a Stripe balance credit worth their monthly price if they already subscribe, otherwise
 *    30 more days on their free trial. The owner and coaches the owner added never pay, so there is nothing to credit.
 *  - Each reward happens once (a guarded status change), a failed Stripe call is retried by the daily job, and nobody can earn more than
 *    REFERRAL_MAX_REWARDS months.
 */

const isReferrer = (u: Pick<UserRow, "role" | "active">) => u.active && (u.role === "COACH" || u.role === "OWNER");

/** Gives a coach (or the owner) a referral code if they have none yet, and returns it. Safe to call on every load. */
export async function ensureReferralCode(row: Pick<UserRow, "id" | "role" | "referralCode">): Promise<string | null> {
  if (row.role !== "COACH" && row.role !== "OWNER") return null;
  if (row.referralCode) return row.referralCode;
  const d = await db();
  for (let i = 0; i < 25; i++) {
    const code = makeReferralCode((n) => randomBytes(n));
    try {
      const [done] = await d.update(users).set({ referralCode: code, updatedAt: new Date() }).where(and(eq(users.id, row.id), isNull(users.referralCode))).returning({ code: users.referralCode });
      if (done?.code) return done.code;
      const [now] = await d.select({ code: users.referralCode }).from(users).where(eq(users.id, row.id)).limit(1);
      if (now?.code) return now.code;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // taken: try another
    }
  }
  throw new Error("Could not make a referral code");
}

/** The active coach (or owner) who owns this code, or null. */
export async function referrerByCode(raw: unknown): Promise<UserRow | null> {
  const code = cleanReferralCode(raw);
  if (!code) return null;
  const d = await db();
  const [row] = await d.select().from(users).where(eq(users.referralCode, code)).limit(1);
  return row && isReferrer(row) ? row : null;
}

const firstName = (name: string | null | undefined): string => (name ?? "").trim().split(/\s+/)[0] || "A coach";

/** Public check at sign-up: whose code is this? Gives a first name only. */
export async function lookupReferrer(raw: unknown): Promise<{ name: string } | null> {
  const r = await referrerByCode(raw);
  return r ? { name: firstName(r.name) } : null;
}

/** A coach signed up with a code: remember who invited them (once). */
export async function recordReferral(refereeId: string, referrer: Pick<UserRow, "id">, code: string): Promise<void> {
  if (refereeId === referrer.id) return;
  const d = await db();
  await d
    .insert(referrals)
    .values({ id: `rf_${randomUUID().replace(/-/g, "").slice(0, 24)}`, referrerId: referrer.id, refereeId, code, status: "SIGNED_UP" })
    .onConflictDoNothing();
}

/** What a coach sees under "Refer a coach". */
export interface ReferralSummary {
  code: string;
  link: string;
  bonusDays: number;
  maxRewards: number;
  invited: number;
  subscribed: number;
  monthsEarned: number;
  items: { name: string; status: ReferralStatus; at: string }[];
}

export async function referralSummary(me: UserRow, origin: string): Promise<ReferralSummary> {
  const code = await ensureReferralCode(me);
  if (!code) throw new Error("Only coaches have a referral code");
  const d = await db();
  const rows = await d.select().from(referrals).where(eq(referrals.referrerId, me.id)).orderBy(desc(referrals.createdAt)).limit(200);
  const people = rows.length ? await d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, rows.map((r) => r.refereeId))) : [];
  const nameOf = new Map(people.map((p) => [p.id, firstName(p.name)]));
  return {
    code,
    link: referralLink(origin, code),
    bonusDays: REFERRAL_BONUS_DAYS,
    maxRewards: REFERRAL_MAX_REWARDS,
    invited: rows.length,
    subscribed: rows.filter((r) => r.status !== "SIGNED_UP").length,
    monthsEarned: rows.filter((r) => r.status === "REWARDED").length,
    items: rows.map((r) => ({ name: nameOf.get(r.refereeId) ?? "A coach", status: r.status as ReferralStatus, at: r.createdAt.toISOString() })),
  };
}

/* ---------------- The reward ---------------- */
async function setRewarded(id: string, kind: string, note: string): Promise<boolean> {
  const d = await db();
  const [done] = await d.update(referrals).set({ status: "REWARDED", rewardKind: kind, rewardNote: note, rewardedAt: new Date() }).where(and(eq(referrals.id, id), eq(referrals.status, "PAID"))).returning({ id: referrals.id });
  return !!done;
}

/**
 * Gives the inviter their free month for one referral that is PAID. Returns true when it is settled (rewarded or capped), false when it
 * has to be tried again later (for example Stripe was unreachable). Never gives the same referral twice.
 */
export async function applyReward(r: ReferralRow): Promise<boolean> {
  const d = await db();
  const [referrer] = await d.select().from(users).where(eq(users.id, r.referrerId)).limit(1);
  if (!referrer) return true;
  const [{ n: earned }] = await d.select({ n: count() }).from(referrals).where(and(eq(referrals.referrerId, r.referrerId), eq(referrals.status, "REWARDED")));
  if (earned >= REFERRAL_MAX_REWARDS) {
    await d.update(referrals).set({ status: "CAPPED", rewardNote: `Limit of ${REFERRAL_MAX_REWARDS} free months reached` }).where(and(eq(referrals.id, r.id), eq(referrals.status, "PAID")));
    return true;
  }

  const [referee] = await d.select({ name: users.name }).from(users).where(eq(users.id, r.refereeId)).limit(1);
  const who = firstName(referee?.name);
  const billing = await ensureBilling(referrer);
  let kind: string;
  let note: string;
  let told: string;

  if (billing.exempt) {
    kind = "EXEMPT";
    note = "Inviter never pays, so there was nothing to credit";
    told = `${who} subscribed. Your account is free, so there is no bill to credit, but thank you for inviting them.`;
  } else if (billing.stripeCustomerId && billing.stripeSubscriptionId && billing.status !== "CANCELED") {
    // They already subscribe: a Stripe credit worth one month of their plan (before GST), used up by their next invoice(s).
    try {
      await stripe().customers.createBalanceTransaction(billing.stripeCustomerId, { amount: -billing.tierCents, currency: "sgd", description: `CoachFlow referral: one month free (${who} subscribed)` });
    } catch (e) {
      console.error("referral credit failed", e instanceof Error ? e.message : e);
      return false;
    }
    kind = "STRIPE_CREDIT";
    note = `Credit of ${billing.tierCents} cents SGD on their next invoice`;
    told = `${who} subscribed, so you get a month free. We've credited one month of your plan to your account; it comes off your next invoice.`;
  } else {
    // Still on the free trial (or lapsed without ever subscribing): 30 more days, counted from the end of the trial if it is still running.
    const now = new Date();
    const base = billing.trialEnd && billing.trialEnd.getTime() > now.getTime() ? billing.trialEnd : now;
    const end = addDays(base, 30);
    await d.update(coachBilling).set({ trialEnd: end, status: "TRIALING", trialStart: billing.trialStart ?? now, warned7: false, warned1: false, updatedAt: now }).where(eq(coachBilling.coachId, r.referrerId));
    await d.update(users).set({ trialEndsAt: end, updatedAt: now }).where(eq(users.id, r.referrerId));
    forgetBillingCache(r.referrerId);
    kind = "TRIAL_EXTENSION";
    note = `Free trial now ends ${end.toISOString().slice(0, 10)}`;
    told = `${who} subscribed, so you get a month free. Your free trial now runs 30 days longer.`;
  }

  if (await setRewarded(r.id, kind, note)) {
    await notify([r.referrerId], "referral_reward", { title: "You earned a free month", body: told, link: "/settings/referrals" });
  }
  return true;
}

/**
 * The invited coach became a paying subscriber: move their referral to PAID and reward the inviter. Safe to call on every Stripe event
 * (only the first call with a SIGNED_UP referral does anything). Never throws.
 */
export async function onCoachPaid(coachId: string): Promise<void> {
  try {
    const d = await db();
    const [r] = await d.update(referrals).set({ status: "PAID", paidAt: new Date() }).where(and(eq(referrals.refereeId, coachId), eq(referrals.status, "SIGNED_UP"))).returning();
    if (r) await applyReward(r);
  } catch (e) {
    console.error("referral reward failed", e);
  }
}

/** The daily job: rewards that could not be given yet (Stripe was unreachable) are tried again. */
export async function retryPendingRewards(): Promise<number> {
  const d = await db();
  const pending = await d.select().from(referrals).where(eq(referrals.status, "PAID")).limit(50);
  let settled = 0;
  for (const r of pending) {
    try {
      if (await applyReward(r)) settled++;
    } catch (e) {
      console.error("referral retry failed", e);
    }
  }
  return settled;
}

/** For the owner's dashboard: how the referral programme is doing. */
export async function referralTotals(): Promise<{ invited: number; subscribed: number; rewarded: number }> {
  const d = await db();
  const rows = await d.select({ status: referrals.status }).from(referrals);
  return { invited: rows.length, subscribed: rows.filter((r) => r.status !== "SIGNED_UP").length, rewarded: rows.filter((r) => r.status === "REWARDED").length };
}
