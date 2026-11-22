import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { addDays } from "@/lib/billing";
import {
  cleanReferralCode,
  makeReferralCode,
  MAX_CLIENT_REWARD_CREDITS,
  referralLink,
  REFERRAL_BONUS_DAYS,
  REFERRAL_CAPS,
  SOLO_REWARD_DAYS,
  type ReferralKind,
  type ReferralStatus,
} from "@/lib/referral";
import { shortName } from "@/lib/signupRules";
import { openProfile } from "./accounts";
import { ensureBilling, forgetBillingCache, stripe } from "./billing";
import { logCredit } from "./credits";
import { db } from "./db";
import { notify } from "./groups";
import { int, isUniqueViolation } from "./http";
import { adjustCredits } from "./schedule";
import { coachBilling, coachSettings, referrals, users, type ReferralRow, type UserRow } from "./schema";

/*
 * Referrals (the rules are in lib/referral.ts). Three kinds, by who invites:
 *  - COACH  A new coach who signs up with a coach's code gets REFERRAL_BONUS_DAYS extra on their free trial (see signup.ts). When that
 *           coach becomes a paying subscriber (Stripe says the subscription is "active": the first real payment went through), the coach
 *           who invited them gets one free month: a Stripe balance credit worth their monthly price if they already subscribe, otherwise
 *           30 more days on their free trial. The owner and coaches the owner added never pay, so there is nothing to credit.
 *  - CLIENT A friend who signs up with a client's link asks that client's coach to take them on. When the coach accepts, the client
 *           earns the session credits their coach has chosen to give (0 = off, the default) and the coach is told either way.
 *  - SOLO   A friend who signs up with a solo user's link starts with REFERRAL_BONUS_DAYS extra on their trial; the inviter gets
 *           SOLO_REWARD_DAYS more on theirs once the friend has confirmed their email (throwaway mailboxes are refused at sign-up).
 * Each reward happens once (a guarded status change), a failed Stripe call is retried by the daily job, and each kind has a cap.
 */

/** Which kind of invitation a person's own code is. */
export function referralKindOf(u: Pick<UserRow, "role" | "coachId">): ReferralKind {
  if (u.role === "OWNER" || u.role === "COACH") return "COACH";
  return u.coachId ? "CLIENT" : "SOLO";
}

const isReferrer = (u: Pick<UserRow, "active">) => u.active;

/** A first name for a notice. Clients keep their name inside their encrypted profile, coaches on the row. */
export function firstNameOf(u: UserRow | undefined | null): string {
  if (!u) return "Someone";
  let name = "";
  try {
    name = u.role === "CLIENT" ? openProfile(u).name : (u.name ?? "");
  } catch {
    name = "";
  }
  return name.trim().split(/\s+/)[0] || "Someone";
}

/** Gives a person a referral code if they have none yet, and returns it. Safe to call on every load. */
export async function ensureReferralCode(row: Pick<UserRow, "id" | "role" | "referralCode">): Promise<string> {
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

/** The active person who owns this code, or null. */
export async function referrerByCode(raw: unknown): Promise<UserRow | null> {
  const code = cleanReferralCode(raw);
  if (!code) return null;
  const d = await db();
  const [row] = await d.select().from(users).where(eq(users.referralCode, code)).limit(1);
  return row && isReferrer(row) ? row : null;
}

/** The active coach this client belongs to, or null. */
export async function coachOfClient(client: Pick<UserRow, "coachId">): Promise<UserRow | null> {
  if (!client.coachId) return null;
  const d = await db();
  const [coach] = await d.select().from(users).where(eq(users.id, client.coachId)).limit(1);
  return coach && coach.active && (coach.role === "COACH" || coach.role === "OWNER") ? coach : null;
}

/** Public check at sign-up: whose code is this, and what kind? Gives first names only. */
export async function lookupReferrer(raw: unknown): Promise<{ name: string; kind: ReferralKind; coachName?: string } | null> {
  const r = await referrerByCode(raw);
  if (!r) return null;
  const kind = referralKindOf(r);
  if (kind === "CLIENT") {
    const coach = await coachOfClient(r);
    if (!coach) return null; // their coach is gone: the code can't bring anyone to a coach
    return { name: firstNameOf(r), kind, coachName: shortName(coach.name ?? coach.username) };
  }
  return { name: firstNameOf(r), kind };
}

/** Someone signed up with a code: remember who invited them (once). */
export async function recordReferral(refereeId: string, referrer: Pick<UserRow, "id">, code: string, kind: ReferralKind): Promise<void> {
  if (refereeId === referrer.id) return;
  const d = await db();
  await d
    .insert(referrals)
    .values({ id: `rf_${randomUUID().replace(/-/g, "").slice(0, 24)}`, referrerId: referrer.id, refereeId, code, kind, status: "SIGNED_UP" })
    .onConflictDoNothing();
}

/* ---------------- What a person sees under "Invite & earn" ---------------- */
export interface ReferralSummary {
  kind: ReferralKind;
  code: string;
  link: string;
  bonusDays: number;
  soloRewardDays: number;
  cap: number;
  invited: number;
  /** Came through: subscribed (coach), joined the coach (client), confirmed their account (solo). */
  converted: number;
  rewards: number;
  items: { name: string; status: ReferralStatus; at: string }[];
  /** A client's view: their coach's first name and how many session credits that coach gives per friend (0 = off). */
  coach?: { name: string; rewardCredits: number };
  /** A coach's view: how many session credits they give a client for each friend who joins (0 = off). */
  clientReward?: { credits: number; max: number };
}

const rewardCreditsOf = async (coachId: string): Promise<number> => {
  const d = await db();
  const [s] = await d.select({ n: coachSettings.referralRewardCredits }).from(coachSettings).where(eq(coachSettings.coachId, coachId)).limit(1);
  return s?.n ?? 0;
};

export async function referralSummary(me: UserRow, origin: string): Promise<ReferralSummary> {
  const kind = referralKindOf(me);
  const code = await ensureReferralCode(me);
  const d = await db();
  const rows = await d.select().from(referrals).where(eq(referrals.referrerId, me.id)).orderBy(desc(referrals.createdAt)).limit(200);
  const people = rows.length ? await d.select().from(users).where(inArray(users.id, rows.map((r) => r.refereeId))) : [];
  const nameOf = new Map(people.map((p) => [p.id, firstNameOf(p)]));
  const out: ReferralSummary = {
    kind,
    code,
    link: referralLink(origin, code, kind),
    bonusDays: REFERRAL_BONUS_DAYS,
    soloRewardDays: SOLO_REWARD_DAYS,
    cap: REFERRAL_CAPS[kind],
    invited: rows.length,
    converted: rows.filter((r) => r.status !== "SIGNED_UP").length,
    rewards: rows.filter((r) => r.status === "REWARDED").length,
    items: rows.map((r) => ({ name: nameOf.get(r.refereeId) ?? "Someone", status: r.status as ReferralStatus, at: r.createdAt.toISOString() })),
  };
  if (kind === "COACH") out.clientReward = { credits: await rewardCreditsOf(me.id), max: MAX_CLIENT_REWARD_CREDITS };
  if (kind === "CLIENT") {
    const coach = await coachOfClient(me);
    if (coach) out.coach = { name: shortName(coach.name ?? coach.username), rewardCredits: await rewardCreditsOf(coach.id) };
  }
  return out;
}

/** A coach chooses how many session credits a client earns when a friend they invited joins (0 turns it off). */
export async function setClientReward(coach: UserRow, value: unknown): Promise<number> {
  // A missing value must not read as 0 (which would switch rewards off): it has to be a real number.
  const credits = int(typeof value === "number" ? value : Number.NaN, "Session credits", 0, MAX_CLIENT_REWARD_CREDITS);
  const d = await db();
  await d
    .insert(coachSettings)
    .values({ coachId: coach.id, referralRewardCredits: credits })
    .onConflictDoUpdate({ target: coachSettings.coachId, set: { referralRewardCredits: credits } });
  return credits;
}

const earnedCount = async (referrerId: string, kind: ReferralKind): Promise<number> => {
  const d = await db();
  const [{ n }] = await d.select({ n: count() }).from(referrals).where(and(eq(referrals.referrerId, referrerId), eq(referrals.kind, kind), eq(referrals.status, "REWARDED")));
  return n;
};

/* ---------------- COACH: the invited coach pays ---------------- */
async function setRewarded(id: string, kind: string, note: string): Promise<boolean> {
  const d = await db();
  const [done] = await d.update(referrals).set({ status: "REWARDED", rewardKind: kind, rewardNote: note, rewardedAt: new Date() }).where(and(eq(referrals.id, id), eq(referrals.status, "PAID"))).returning({ id: referrals.id });
  return !!done;
}

/**
 * Gives the inviter their free month for one coach referral that is PAID. Returns true when it is settled (rewarded or capped), false when it
 * has to be tried again later (for example Stripe was unreachable). Never gives the same referral twice.
 */
export async function applyReward(r: ReferralRow): Promise<boolean> {
  const d = await db();
  const [referrer] = await d.select().from(users).where(eq(users.id, r.referrerId)).limit(1);
  if (!referrer) return true;
  if ((await earnedCount(r.referrerId, "COACH")) >= REFERRAL_CAPS.COACH) {
    await d.update(referrals).set({ status: "CAPPED", rewardNote: `Limit of ${REFERRAL_CAPS.COACH} free months reached` }).where(and(eq(referrals.id, r.id), eq(referrals.status, "PAID")));
    return true;
  }

  const [referee] = await d.select().from(users).where(eq(users.id, r.refereeId)).limit(1);
  const who = firstNameOf(referee);
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
    const [r] = await d.update(referrals).set({ status: "PAID", paidAt: new Date() }).where(and(eq(referrals.refereeId, coachId), eq(referrals.kind, "COACH"), eq(referrals.status, "SIGNED_UP"))).returning();
    if (r) await applyReward(r);
  } catch (e) {
    console.error("referral reward failed", e);
  }
}

/** The daily job: rewards that could not be given yet (Stripe was unreachable) are tried again. */
export async function retryPendingRewards(): Promise<number> {
  const d = await db();
  const pending = await d.select().from(referrals).where(and(eq(referrals.kind, "COACH"), eq(referrals.status, "PAID"))).limit(50);
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

/* ---------------- CLIENT: the coach accepts the friend ---------------- */
/**
 * A coach accepted a client. If that client came through another client's invitation, the inviter earns what the coach has set (session
 * credits; 0 = nothing) and the coach is told who brought them. Safe to call for any accepted client; never throws.
 */
export async function onClientAccepted(clientId: string, coach: UserRow): Promise<void> {
  try {
    const d = await db();
    // The first caller wins this change, so a repeat (or a second tab) can never pay twice.
    const [r] = await d.update(referrals).set({ status: "JOINED" }).where(and(eq(referrals.refereeId, clientId), eq(referrals.kind, "CLIENT"), eq(referrals.status, "SIGNED_UP"))).returning();
    if (!r) return;
    const [referrer] = await d.select().from(users).where(eq(users.id, r.referrerId)).limit(1);
    const [friend] = await d.select().from(users).where(eq(users.id, clientId)).limit(1);
    if (!referrer) return;
    const friendName = firstNameOf(friend);
    const referrerName = firstNameOf(referrer);
    // "Ravi K." would end a sentence with two full stops, so the dot is dropped.
    const coachName = shortName(coach.name ?? coach.username).replace(/\.$/, "");

    const credits = await rewardCreditsOf(coach.id);
    // The inviter must still be this coach's own client (they may have moved on since).
    const eligible = referrer.active && referrer.coachId === coach.id && credits > 0;
    const capped = eligible && (await earnedCount(referrer.id, "CLIENT")) >= REFERRAL_CAPS.CLIENT;

    let gave = 0;
    if (eligible && !capped) {
      try {
        await adjustCredits(referrer, credits);
        await logCredit({ clientId: referrer.id, coachId: coach.id, pool: "SESSION", kind: "ADJUSTMENT", delta: credits, label: "Referral reward", note: `${friendName} joined ${coachName} through you` });
        await d.update(referrals).set({ status: "REWARDED", rewardKind: "SESSION_CREDIT", rewardNote: `${credits} session credit${credits === 1 ? "" : "s"}`, rewardedAt: new Date() }).where(eq(referrals.id, r.id));
        gave = credits;
      } catch (e) {
        console.error("referral credit failed", e);
      }
    } else if (capped) {
      await d.update(referrals).set({ status: "CAPPED", rewardNote: `Limit of ${REFERRAL_CAPS.CLIENT} rewards reached` }).where(eq(referrals.id, r.id));
    }

    const plural = gave === 1 ? "" : "s";
    await notify(
      [referrer.id],
      "referral_reward",
      gave
        ? { title: "You earned a free session", body: `${friendName} joined ${coachName}. ${gave} session credit${plural} ${gave === 1 ? "was" : "were"} added to your package. Thanks for spreading the word!`, link: "/settings/referrals" }
        : { title: `${friendName} joined ${coachName}`, body: `Your friend ${friendName} is now training with ${coachName}.`, link: "/settings/referrals" },
    );
    await notify(
      [coach.id],
      "referral_joined",
      {
        title: `${friendName} came through ${referrerName}`,
        body: gave
          ? `${friendName} joined through ${referrerName}'s invitation. ${gave} session credit${plural} ${gave === 1 ? "was" : "were"} added to ${referrerName}'s package as a thank-you. You can change this in Settings, Invite & earn.`
          : capped
            ? `${friendName} joined through ${referrerName}'s invitation. ${referrerName} has reached the limit of ${REFERRAL_CAPS.CLIENT} referral rewards, so nothing was added.`
            : `${friendName} joined through ${referrerName}'s invitation. Referral rewards are off, so no credit was added. You can switch them on in Settings, Invite & earn.`,
        link: "/settings/referrals",
      },
      { email: false },
    );
  } catch (e) {
    console.error("client referral failed", e);
  }
}

/* ---------------- SOLO: the friend confirms their account ---------------- */
/**
 * A person confirmed their email. If they signed up through a solo user's invitation, the inviter's free trial grows by SOLO_REWARD_DAYS.
 * Safe to call for anyone; never throws.
 */
export async function onFriendConfirmed(userId: string): Promise<void> {
  try {
    const d = await db();
    const [r] = await d.update(referrals).set({ status: "JOINED" }).where(and(eq(referrals.refereeId, userId), eq(referrals.kind, "SOLO"), eq(referrals.status, "SIGNED_UP"))).returning();
    if (!r) return;
    const [referrer] = await d.select().from(users).where(eq(users.id, r.referrerId)).limit(1);
    const [friend] = await d.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!referrer) return;
    const friendName = firstNameOf(friend);

    // Someone who has since joined a coach has no trial of their own to extend.
    if (!referrer.active || referrer.trialEndsAt === null) {
      await notify([referrer.id], "referral_reward", { title: `${friendName} joined`, body: `Your friend ${friendName} confirmed their account.`, link: "/settings/referrals" });
      return;
    }
    if ((await earnedCount(referrer.id, "SOLO")) >= REFERRAL_CAPS.SOLO) {
      await d.update(referrals).set({ status: "CAPPED", rewardNote: `Limit of ${REFERRAL_CAPS.SOLO} bonus months reached` }).where(eq(referrals.id, r.id));
      await notify([referrer.id], "referral_reward", { title: `${friendName} joined`, body: `Your friend ${friendName} confirmed their account. You have reached the limit of ${REFERRAL_CAPS.SOLO} bonus months, so nothing was added.`, link: "/settings/referrals" });
      return;
    }
    const now = new Date();
    const base = referrer.trialEndsAt.getTime() > now.getTime() ? referrer.trialEndsAt : now;
    const end = addDays(base, SOLO_REWARD_DAYS);
    await d.update(users).set({ trialEndsAt: end, updatedAt: now }).where(eq(users.id, referrer.id));
    await d.update(referrals).set({ status: "REWARDED", rewardKind: "TRIAL_EXTENSION", rewardNote: `Free trial now ends ${end.toISOString().slice(0, 10)}`, rewardedAt: now }).where(eq(referrals.id, r.id));
    await notify([referrer.id], "referral_reward", { title: "You earned a free month", body: `${friendName} joined, so your free trial now runs ${SOLO_REWARD_DAYS} days longer. Thanks for spreading the word!`, link: "/settings/referrals" });
  } catch (e) {
    console.error("solo referral failed", e);
  }
}

/** For the owner's dashboard: how the referral programme is doing. */
export async function referralTotals(): Promise<{ invited: number; subscribed: number; rewarded: number; friends: { clients: number; solo: number } }> {
  const d = await db();
  const rows = await d.select({ status: referrals.status, kind: referrals.kind }).from(referrals);
  const coach = rows.filter((r) => r.kind === "COACH");
  return {
    invited: coach.length,
    subscribed: coach.filter((r) => r.status !== "SIGNED_UP").length,
    rewarded: coach.filter((r) => r.status === "REWARDED").length,
    friends: { clients: rows.filter((r) => r.kind === "CLIENT").length, solo: rows.filter((r) => r.kind === "SOLO").length },
  };
}
