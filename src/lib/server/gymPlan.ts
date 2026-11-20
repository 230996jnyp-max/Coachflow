import "server-only";
import { and, count, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import { daysLeft, GYM_GRACE_DAYS, GYM_SMALL_MAX_COACHES, gymLookupKey, gymMonthlyCents, gymPlanState, needsCustomPlan, parseCustomPrice, type GymPlanState, type GymPlanStatus } from "@/lib/gymBilling";
import { sgd } from "@/lib/billing";
import { SUPPORT_EMAIL } from "@/lib/support";
import { billingEnforced, stripe, stripeReady, taxOn } from "./billing";
import { db } from "./db";
import { notify } from "./groups";
import { badRequest, conflict, HttpError } from "./http";
import { escapeHtml, layout, sendMail } from "./mail";
import { hit } from "./rateLimit";
import { coachBilling, gymBilling, gymMembers, gymOrgs, users, type GymBillingRow, type UserRow } from "./schema";

type GymRow = typeof gymOrgs.$inferSelect;

/*
 * Gym subscriptions (rules in lib/gymBilling.ts). A paying gym covers every coach in it: a coach who already had their own subscription
 * keeps it until the end of the period they paid for, then it stops renewing, so nobody pays twice. When a payment fails the gym has
 * GYM_GRACE_DAYS to fix it; after that the gym's portal and coaches are paused (nothing is deleted).
 * The pause only applies once BILLING_ENFORCED=1, like coach subscriptions.
 */

/* ---------------- The gym's billing row and what it means ---------------- */
async function rowOf(gymId: string): Promise<GymBillingRow | null> {
  const d = await db();
  const [r] = await d.select().from(gymBilling).where(eq(gymBilling.gymId, gymId)).limit(1);
  return r ?? null;
}
export async function ensureGymBilling(gymId: string): Promise<GymBillingRow> {
  const have = await rowOf(gymId);
  if (have) return have;
  const d = await db();
  await d.insert(gymBilling).values({ gymId }).onConflictDoNothing();
  return (await rowOf(gymId))!;
}

const fieldsOf = (gym: Pick<GymRow, "trialEndsAt">, row: GymBillingRow | null) => ({
  free: gym.trialEndsAt === null && !row?.stripeSubscriptionId,
  trialEnd: gym.trialEndsAt,
  hasSubscription: !!row?.stripeSubscriptionId,
  status: row?.status ?? "TRIALING",
  periodEnd: row?.periodEnd ?? null,
  pastDueSince: row?.pastDueSince ?? null,
});
export const stateOf = (gym: Pick<GymRow, "trialEndsAt">, row: GymBillingRow | null, now = new Date()): GymPlanState => gymPlanState(fieldsOf(gym, row), now);

const blockCache = new Map<string, { blocked: boolean; at: number }>();
export const forgetGymPlan = (gymId: string) => void blockCache.delete(gymId);

/** Is this gym paused right now? (Only ever true once BILLING_ENFORCED=1.) Remembered for a few seconds, as it is asked on every request. */
export async function gymBlocked(gym: GymRow): Promise<boolean> {
  if (!billingEnforced()) return false;
  const hit = blockCache.get(gym.id);
  if (hit && Date.now() - hit.at < 20_000) return hit.blocked;
  const blocked = stateOf(gym, await rowOf(gym.id)).blocked;
  blockCache.set(gym.id, { blocked, at: Date.now() });
  return blocked;
}

const activeCoaches = async (gymId: string): Promise<number> => {
  const d = await db();
  const [r] = await d.select({ n: count() }).from(gymMembers).where(and(eq(gymMembers.gymId, gymId), eq(gymMembers.status, "ACTIVE")));
  return Number(r.n);
};

/* ---------------- What the owner and the app see ---------------- */
export interface GymPlanView {
  gymId: string;
  gymName: string;
  status: GymPlanStatus;
  blocked: boolean;
  graceDaysLeft: number | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  hasSubscription: boolean;
  renewsOn: string | null;
  cancelAtPeriodEnd: boolean;
  /** What the gym pays each month, in cents (before GST). */
  priceCents: number;
  /** A custom price agreed with the platform owner. */
  customPrice: boolean;
  coaches: number;
  smallMax: number;
  /** More coaches than the flat plan covers and no custom price yet: the gym asks for one instead of subscribing. */
  needsCustomPlan: boolean;
  planRequested: boolean;
  gst: boolean;
  stripeReady: boolean;
  /** Is the pause switched on for this deployment? */
  enforced: boolean;
}

export async function gymPlanView(gym: GymRow, now = new Date()): Promise<GymPlanView> {
  const row = await rowOf(gym.id);
  const st = stateOf(gym, row, now);
  const coaches = await activeCoaches(gym.id);
  const custom = row?.priceCents ?? null;
  return {
    gymId: gym.id,
    gymName: gym.name,
    status: st.status,
    blocked: st.blocked,
    graceDaysLeft: st.graceDaysLeft,
    trialEndsAt: gym.trialEndsAt ? gym.trialEndsAt.toISOString() : null,
    trialDaysLeft: row?.stripeSubscriptionId ? null : daysLeft(gym.trialEndsAt, now),
    hasSubscription: !!row?.stripeSubscriptionId,
    renewsOn: row?.periodEnd ? row.periodEnd.toISOString() : null,
    cancelAtPeriodEnd: !!row?.cancelAtPeriodEnd,
    priceCents: gymMonthlyCents(custom),
    customPrice: !!custom && custom > 0,
    coaches,
    smallMax: GYM_SMALL_MAX_COACHES,
    needsCustomPlan: needsCustomPlan(coaches, custom),
    planRequested: !!row?.planRequestedAt,
    gst: taxOn(),
    stripeReady: stripeReady(),
    enforced: billingEnforced(),
  };
}

/* ---------------- Checkout and the customer portal (the gym owner only) ---------------- */
let standardPriceId: string | null = null;
async function standardPrice(cents: number): Promise<string> {
  if (standardPriceId) return standardPriceId;
  const list = await stripe().prices.list({ lookup_keys: [gymLookupKey(cents)], active: true, limit: 1 });
  const id = list.data[0]?.id;
  if (!id) throw new HttpError(503, "Gym billing isn't fully set up yet (the gym price is missing). Please try again later.");
  standardPriceId = id;
  return id;
}

export async function startGymCheckout(owner: UserRow, gym: GymRow, origin: string): Promise<string> {
  const row = await ensureGymBilling(gym.id);
  const view = await gymPlanView(gym);
  if (view.status === "FREE") throw badRequest("Your gym has free access, so there is nothing to subscribe to.");
  if (row.stripeSubscriptionId && row.status !== "CANCELED") throw badRequest("Your gym already has a subscription. Use Manage billing to change it.");
  if (view.needsCustomPlan) throw badRequest(`Your gym has more than ${GYM_SMALL_MAX_COACHES} coaches, so the price is agreed with us. Use "Ask for a custom plan" and we will get back to you.`);
  const cents = view.priceCents;
  const custom = view.customPrice;
  // What is left of the free month carries over (Stripe needs at least two days to schedule it).
  const left = gym.trialEndsAt && !row.stripeSubscriptionId ? gym.trialEndsAt : null;
  const carry = left && left.getTime() - Date.now() >= 2 * 86_400_000 + 60_000 ? Math.floor(left.getTime() / 1000) : undefined;
  const line: Stripe.Checkout.SessionCreateParams.LineItem = custom
    ? { price_data: { currency: "sgd", unit_amount: cents, recurring: { interval: "month" }, product_data: { name: `CoachFlow gym plan: ${gym.name}`.slice(0, 120) } }, quantity: 1 }
    : { price: await standardPrice(cents), quantity: 1 };
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [line],
    ...(row.stripeCustomerId ? { customer: row.stripeCustomerId, customer_update: { address: "auto", name: "auto" } } : { customer_email: owner.email ?? undefined }),
    subscription_data: { ...(carry ? { trial_end: carry } : {}), metadata: { gymId: gym.id } },
    metadata: { gymId: gym.id },
    client_reference_id: gym.id,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    automatic_tax: { enabled: taxOn() },
    success_url: `${origin}/gym-admin?billing=success`,
    cancel_url: `${origin}/gym-admin?billing=cancelled`,
  });
  if (!session.url) throw new HttpError(502, "Stripe didn't return a checkout page. Please try again.");
  return session.url;
}

export async function openGymPortal(gym: GymRow, origin: string): Promise<string> {
  const row = await rowOf(gym.id);
  if (!row?.stripeCustomerId) throw badRequest("Your gym doesn't have a subscription yet. Subscribe first.");
  const session = await stripe().billingPortal.sessions.create({ customer: row.stripeCustomerId, return_url: `${origin}/gym-admin` });
  return session.url;
}

/* ---------------- A big gym asks for a custom price ---------------- */
export async function requestCustomPlan(owner: UserRow, gym: GymRow, note: unknown): Promise<void> {
  await hit(`gymplan:${gym.id}`, 3, 86_400_000, "You already asked today. We'll be in touch soon.");
  const text = typeof note === "string" ? note.trim().slice(0, 1000) : "";
  const view = await gymPlanView(gym);
  await ensureGymBilling(gym.id);
  const d = await db();
  await d.update(gymBilling).set({ planRequestedAt: new Date(), updatedAt: new Date() }).where(eq(gymBilling.gymId, gym.id));
  const who = owner.name ?? owner.username;
  const lines = [`${gym.name} (${view.coaches} active coaches) asked for a custom plan.`, `Contact: ${who}${owner.email ? ` <${owner.email}>` : ""}`, text ? `Their note: ${text}` : ""].filter(Boolean);
  await sendMail({ to: SUPPORT_EMAIL, subject: `CoachFlow gym plan request: ${gym.name}`, text: `${lines.join("\n")}\n\nSet their price in Admin, Gyms.`, html: layout("A gym asked for a custom plan", lines.map((l) => `<p style="margin:0 0 10px;color:#E8ECF4;">${escapeHtml(l)}</p>`).join("")) }).catch(() => undefined);
  const platform = await d.select({ id: users.id }).from(users).where(eq(users.role, "OWNER"));
  await notify(platform.map((p) => p.id), "gym_plan_request", { title: "A gym asked for a custom plan", body: `${gym.name} has ${view.coaches} active coaches and asked for a price.${text ? ` They wrote: ${text.slice(0, 200)}` : ""}`, link: "/admin" }, { email: false });
}

/** The platform owner sets (or clears) a gym's custom monthly price, in dollars. */
export async function setCustomPrice(gymId: string, dollars: unknown): Promise<number | null> {
  let cents: number | null;
  try {
    cents = parseCustomPrice(dollars);
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : "That price isn't valid.");
  }
  const d = await db();
  const [gym] = await d.select().from(gymOrgs).where(eq(gymOrgs.id, gymId)).limit(1);
  if (!gym) throw badRequest("That gym doesn't exist.");
  const row = await ensureGymBilling(gymId);
  if (row.stripeSubscriptionId && row.status !== "CANCELED" && cents !== row.priceCents) throw conflict("This gym already subscribes. Change its price in Stripe, or ask the gym to cancel first.");
  await d.update(gymBilling).set({ priceCents: cents, updatedAt: new Date() }).where(eq(gymBilling.gymId, gymId));
  if (cents) await notify([gym.ownerId], "gym_plan_price", { title: "Your gym's price is set", body: `CoachFlow set your gym's plan to S$${cents / 100} a month. You can subscribe from the Billing tab.`, link: "/gym-admin" });
  return cents;
}

/* ---------------- A paying gym covers its coaches ---------------- */
/**
 * A coach who already pays for their own CoachFlow keeps it until the end of the period they paid for, then it stops renewing (so nobody pays
 * twice). Only done once the gym itself is paying. Never throws.
 */
export async function coverCoach(coachId: string, gym: GymRow): Promise<void> {
  try {
    const st = stateOf(gym, await rowOf(gym.id));
    if (st.status !== "ACTIVE" && st.status !== "GRACE") return;
    const d = await db();
    const [cb] = await d.select().from(coachBilling).where(eq(coachBilling.coachId, coachId)).limit(1);
    if (!cb?.stripeSubscriptionId || cb.cancelAtPeriodEnd || !["ACTIVE", "TRIALING", "PAST_DUE"].includes(cb.status)) return;
    await stripe().subscriptions.update(cb.stripeSubscriptionId, { cancel_at_period_end: true });
    await d.update(coachBilling).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(coachBilling.coachId, coachId));
    await notify([coachId], "gym_covers_you", { title: "Your gym now covers CoachFlow", body: `${gym.name} pays for CoachFlow, so your own subscription won't renew after the period you've already paid for. You won't be charged again.`, link: "/settings" });
  } catch (e) {
    console.error("cover coach failed", e instanceof Error ? e.message : e);
  }
}

async function coverGymCoaches(gym: GymRow): Promise<void> {
  const d = await db();
  const members = await d.select({ userId: gymMembers.userId }).from(gymMembers).where(and(eq(gymMembers.gymId, gym.id), eq(gymMembers.status, "ACTIVE")));
  for (const m of members) await coverCoach(m.userId, gym);
}

/* ---------------- Stripe events ---------------- */
const ourStatus = (s: string): string | null => (s === "trialing" ? "TRIALING" : s === "active" ? "ACTIVE" : s === "past_due" || s === "unpaid" ? "PAST_DUE" : s === "canceled" ? "CANCELED" : null);
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : ((v as { id?: string } | null)?.id ?? null));

async function gymIdFor(obj: { metadata?: Record<string, string> | null; customer?: unknown }): Promise<string | null> {
  if (obj.metadata?.gymId) return obj.metadata.gymId;
  const cust = idOf(obj.customer);
  if (!cust) return null;
  const d = await db();
  const [r] = await d.select({ gymId: gymBilling.gymId }).from(gymBilling).where(eq(gymBilling.stripeCustomerId, cust)).limit(1);
  return r?.gymId ?? null;
}

async function ownerOf(gym: GymRow): Promise<UserRow | null> {
  const d = await db();
  const [u] = await d.select().from(users).where(eq(users.id, gym.ownerId)).limit(1);
  return u ?? null;
}

async function paymentFailedMail(gym: GymRow, origin: string): Promise<void> {
  const o = await ownerOf(gym);
  if (!o?.email) return;
  const link = `${origin}/gym-admin`;
  const text = `Hi ${(o.name ?? "there").split(" ")[0]},\n\nThe latest CoachFlow payment for ${gym.name} didn't go through. Your gym keeps working for ${GYM_GRACE_DAYS} more days. Please update the card to avoid a pause.\n\nUpdate billing: ${link}\n\nNothing is deleted if the gym is paused, and it comes straight back once the payment goes through.`;
  await sendMail({ to: o.email, subject: `CoachFlow: payment for ${gym.name} failed`, text, html: layout("Your gym's payment didn't go through", `<p style="margin:0 0 12px;color:#E8ECF4;">The latest payment for <strong>${escapeHtml(gym.name)}</strong> didn't go through. Your gym keeps working for <strong>${GYM_GRACE_DAYS} more days</strong>. Please update the card to avoid a pause.</p><p style="margin:0;color:#8892A6;font-size:13px;">Nothing is deleted if the gym is paused, and it comes straight back once the payment goes through.</p>`, { label: "Update billing", href: link }) }).catch(() => undefined);
}

/**
 * Applies one verified Stripe event if it belongs to a gym. Returns null when it doesn't (so the coach handler can take it), and
 * whether it was one we act on otherwise. Safe to receive more than once.
 */
export async function handleGymEvent(event: Stripe.Event): Promise<boolean | null> {
  const obj = event.data.object as unknown as { metadata?: Record<string, string> | null; customer?: unknown; id?: string; status?: string; mode?: string; subscription?: unknown; cancel_at_period_end?: boolean; items?: { data: { current_period_end?: number }[] } };
  const gymId = await gymIdFor(obj);
  if (!gymId) return null;
  const d = await db();
  const [gym] = await d.select().from(gymOrgs).where(eq(gymOrgs.id, gymId)).limit(1);
  if (!gym) return null;
  const before = await ensureGymBilling(gymId);
  const wasPaying = ["ACTIVE", "GRACE"].includes(stateOf(gym, before).status);
  const origin = process.env.APP_URL || "";
  let handled = true;

  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription") {
        handled = false;
        break;
      }
      await d.update(gymBilling).set({ stripeCustomerId: idOf(obj.customer), stripeSubscriptionId: idOf(obj.subscription), status: "ACTIVE", pastDueSince: null, updatedAt: new Date() }).where(eq(gymBilling.gymId, gymId));
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const status = ourStatus(String(obj.status));
      const end = obj.items?.data[0]?.current_period_end;
      await d
        .update(gymBilling)
        .set({
          stripeCustomerId: idOf(obj.customer),
          stripeSubscriptionId: obj.id ?? before.stripeSubscriptionId,
          ...(status ? { status } : {}),
          periodEnd: end ? new Date(end * 1000) : before.periodEnd,
          cancelAtPeriodEnd: !!obj.cancel_at_period_end,
          // Paying again clears the grace period and lets the next failure send its warning.
          ...(status === "ACTIVE" || status === "TRIALING" ? { pastDueSince: null, warnedGrace: false, warned1: false } : status === "PAST_DUE" && !before.pastDueSince ? { pastDueSince: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(gymBilling.gymId, gymId));
      break;
    }
    case "customer.subscription.deleted":
      await d.update(gymBilling).set({ status: "CANCELED", periodEnd: new Date(), cancelAtPeriodEnd: false, updatedAt: new Date() }).where(eq(gymBilling.gymId, gymId));
      break;
    case "invoice.payment_failed": {
      await d.update(gymBilling).set({ status: "PAST_DUE", pastDueSince: before.pastDueSince ?? new Date(), updatedAt: new Date() }).where(eq(gymBilling.gymId, gymId));
      if (!before.warnedGrace) {
        await d.update(gymBilling).set({ warnedGrace: true }).where(eq(gymBilling.gymId, gymId));
        await paymentFailedMail(gym, origin);
      }
      break;
    }
    default:
      handled = false;
  }
  forgetGymPlan(gymId);
  const after = await rowOf(gymId);
  // The gym has just started paying (or paid again): its coaches' own subscriptions stop renewing.
  if (handled && !wasPaying && ["ACTIVE", "GRACE"].includes(stateOf(gym, after).status)) await coverGymCoaches(gym);
  return handled;
}

/* ---------------- Reminder emails (daily) ---------------- */
async function mailOwner(gym: GymRow, subject: string, title: string, body: string, origin: string): Promise<boolean> {
  const o = await ownerOf(gym);
  if (!o?.email) return false;
  const link = `${origin}/gym-admin`;
  const res = await sendMail({ to: o.email, subject, text: `Hi ${(o.name ?? "there").split(" ")[0]},\n\n${body}\n\n${link}`, html: layout(title, `<p style="margin:0 0 12px;color:#E8ECF4;">${escapeHtml(body)}</p>`, { label: "Open gym billing", href: link }) }).catch(() => null);
  return !!res && res.status !== "failed";
}

/** Reminds gym owners: the free month ends in a week or tomorrow, and a failed payment has two days of grace left. Each is sent once. */
export async function sendGymReminders(origin: string, now = new Date()): Promise<{ trial: number; grace: number }> {
  const d = await db();
  let trial = 0;
  let grace = 0;
  const gyms = await d.select().from(gymOrgs).where(and(eq(gymOrgs.status, "ACTIVE")));
  if (!gyms.length) return { trial, grace };
  const rows = await d.select().from(gymBilling).where(inArray(gymBilling.gymId, gyms.map((g) => g.id)));
  const by = new Map(rows.map((r) => [r.gymId, r]));
  for (const gym of gyms) {
    const row = by.get(gym.id) ?? null;
    const st = stateOf(gym, row, now);
    if (st.status === "TRIALING" && gym.trialEndsAt) {
      const left = Math.ceil((gym.trialEndsAt.getTime() - now.getTime()) / 86_400_000);
      const w = left <= 1 && !row?.warned1 ? "1" : left <= 7 && !row?.warned7 ? "7" : null;
      if (!w || left < 1) continue;
      const when = left <= 1 ? "tomorrow" : `in ${left} days`;
      const ok = await mailOwner(gym, left <= 1 ? "Your CoachFlow gym trial ends tomorrow" : `Your CoachFlow gym trial ends in ${left} days`, `Your gym's free month ends ${when}`, `The free month for ${gym.name} ends ${when}. Subscribe to keep the gym portal and every coach in your gym running. Small gyms pay a flat ${sgd(gymMonthlyCents(row?.priceCents))} a month.`, origin);
      if (!ok) continue;
      await ensureGymBilling(gym.id);
      await d.update(gymBilling).set(w === "1" ? { warned1: true, warned7: true, updatedAt: now } : { warned7: true, updatedAt: now }).where(eq(gymBilling.gymId, gym.id));
      trial++;
    } else if (st.status === "GRACE" && (st.graceDaysLeft ?? 9) <= 2 && !row?.warned1) {
      const ok = await mailOwner(gym, `CoachFlow: ${gym.name} will be paused in ${st.graceDaysLeft} day${st.graceDaysLeft === 1 ? "" : "s"}`, "Your gym will be paused soon", `The payment for ${gym.name} still hasn't gone through. The gym and its coaches will be paused in ${st.graceDaysLeft} day${st.graceDaysLeft === 1 ? "" : "s"} unless the card is updated. Nothing is deleted.`, origin);
      if (!ok) continue;
      await d.update(gymBilling).set({ warned1: true, updatedAt: now }).where(eq(gymBilling.gymId, gym.id));
      grace++;
    }
  }
  return { trial, grace };
}

/** For the owner's Admin list: each gym's plan in a line. */
export async function planOverview(gymIds: string[]): Promise<Map<string, { status: GymPlanStatus; priceCents: number; custom: boolean; requested: boolean }>> {
  const out = new Map<string, { status: GymPlanStatus; priceCents: number; custom: boolean; requested: boolean }>();
  if (!gymIds.length) return out;
  const d = await db();
  const gyms = await d.select().from(gymOrgs).where(inArray(gymOrgs.id, gymIds));
  const rows = await d.select().from(gymBilling).where(inArray(gymBilling.gymId, gymIds));
  const by = new Map(rows.map((r) => [r.gymId, r]));
  for (const g of gyms) {
    const r = by.get(g.id) ?? null;
    out.set(g.id, { status: stateOf(g, r).status, priceCents: gymMonthlyCents(r?.priceCents), custom: !!r?.priceCents, requested: !!r?.planRequestedAt && !r?.priceCents });
  }
  return out;
}


/* ---------------- For the signed-in person ---------------- */
/** The compact plan the app shows a gym's owner and coaches (name, state, price). Null when the person isn't an active member of a gym. */
export async function gymPlanForUser(userId: string): Promise<{ name: string; ownerName: string; isOwner: boolean; status: GymPlanStatus; blocked: boolean; graceDaysLeft: number | null; trialDaysLeft: number | null; priceCents: number; needsCustomPlan: boolean; coaches: number; smallMax: number; planRequested: boolean } | null> {
  const d = await db();
  const [m] = await d.select({ gym: gymOrgs }).from(gymMembers).innerJoin(gymOrgs, eq(gymOrgs.id, gymMembers.gymId)).where(and(eq(gymMembers.userId, userId), eq(gymMembers.status, "ACTIVE"))).limit(1);
  if (!m) return null;
  const v = await gymPlanView(m.gym);
  const owner = await ownerOf(m.gym);
  return { name: m.gym.name, ownerName: (owner?.name ?? "the gym owner").split(" ")[0], isOwner: m.gym.ownerId === userId, status: v.status, blocked: v.blocked, graceDaysLeft: v.graceDaysLeft, trialDaysLeft: v.trialDaysLeft, priceCents: v.priceCents, needsCustomPlan: v.needsCustomPlan, coaches: v.coaches, smallMax: v.smallMax, planRequested: v.planRequested };
}
