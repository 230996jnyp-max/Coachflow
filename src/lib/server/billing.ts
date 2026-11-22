import "server-only";
import Stripe from "stripe";
import { and, eq, isNull, sql } from "drizzle-orm";
import { addDays, effectiveStatus, isBlockedStatus, lookupKey, sgd, tierFor, TRIAL_DAYS, trialDaysLeft, type BillingInfo, type BillingStatus } from "@/lib/billing";
import { db, isLocalTestMode } from "./db";
import { badRequest, HttpError } from "./http";
import { escapeHtml, layout, sendMail } from "./mail";
import { coachBilling, users, type CoachBillingRow, type UserRow } from "./schema";

/*
 * Coach subscriptions with Stripe (Singapore dollars). The 30-day free trial is tracked here, with no card; subscribing in Stripe
 * Checkout carries over whatever is left of it. The monthly price follows the number of active clients and only ever changes on the
 * next renewal (no mid-month charges). The owner and coaches the owner added are exempt. Nothing is ever deleted when a
 * subscription lapses: the coach and their clients are simply paused until it is renewed.
 */

/** The subscription requirement is only applied once the owner switches it on (BILLING_ENFORCED=1). */
export const billingEnforced = (): boolean => process.env.BILLING_ENFORCED === "1";
/** GST is added at checkout by Stripe Tax (STRIPE_TAX=1, after Stripe Tax is set up for Singapore). */
export const taxOn = (): boolean => process.env.STRIPE_TAX === "1";
export const stripeReady = (): boolean => !!process.env.STRIPE_SECRET_KEY;

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new HttpError(503, "Billing isn't set up yet. Please try again later.");
  if (!client) {
    // Local testing only: talk to a stand-in Stripe (host:port) instead of the real one.
    const fake = process.env.PAYMENTS_FAKE_STRIPE;
    if (fake && isLocalTestMode()) {
      const [host, port] = fake.split(":");
      client = new Stripe(process.env.STRIPE_SECRET_KEY, { host, port: Number(port), protocol: "http" });
    } else client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}
/** Tests only: swap in a stand-in for Stripe. */
export function setStripeForTests(c: unknown) {
  client = c as Stripe | null;
}

/* ---------------- The coach's billing row ---------------- */
export async function getBilling(coachId: string): Promise<CoachBillingRow | null> {
  const d = await db();
  const [row] = await d.select().from(coachBilling).where(eq(coachBilling.coachId, coachId)).limit(1);
  return row ?? null;
}

/**
 * The billing row of a coach, made on first use. A coach who signed up themselves has a free month from sign-up (`users.trial_ends_at`),
 * and billing uses that same date, so there is one trial. A coach with no such date existed before self sign-up (the owner, coaches the
 * owner added, the pilot coaches), so they are exempt; the owner can switch that off in Admin.
 */
export async function ensureBilling(coach: Pick<UserRow, "id">): Promise<CoachBillingRow> {
  const have = await getBilling(coach.id);
  if (have) return have;
  const d = await db();
  const [u] = await d.select({ role: users.role, trialEndsAt: users.trialEndsAt }).from(users).where(eq(users.id, coach.id)).limit(1);
  const end = u?.role === "COACH" ? u.trialEndsAt : null;
  await d
    .insert(coachBilling)
    .values(end ? { coachId: coach.id, exempt: false, status: "TRIALING", trialStart: addDays(end, -TRIAL_DAYS), trialEnd: end } : { coachId: coach.id, exempt: true, status: "TRIALING" })
    .onConflictDoNothing();
  return (await getBilling(coach.id))!;
}

/** A coach in a gym is covered by the gym (gym plans come later), so they and their clients never need their own subscription. */
export async function coveredByGym(coachId: string): Promise<boolean> {
  const { membershipOf } = await import("./gymOrg");
  const m = await membershipOf(coachId);
  return !!m && m.member.status === "ACTIVE";
}

/** A coach approved from a sign-up request starts the 30-day free trial now. */
export async function startTrial(coachId: string, now = new Date()): Promise<void> {
  const d = await db();
  await d.insert(coachBilling).values({ coachId, exempt: false, status: "TRIALING", trialStart: now, trialEnd: addDays(now, TRIAL_DAYS) }).onConflictDoNothing();
}

/** A coach the owner added (a tester) never pays. */
export async function markExempt(coachId: string): Promise<void> {
  const d = await db();
  await d.insert(coachBilling).values({ coachId, exempt: true, status: "TRIALING" }).onConflictDoUpdate({ target: coachBilling.coachId, set: { exempt: true, updatedAt: new Date() } });
  forget(coachId);
}

/** The owner turns "Exempt / Beta Lifetime Access" on or off. Turning it off gives a coach who never had a trial a fresh 30 days. */
export async function setExempt(coachId: string, exempt: boolean, now = new Date()): Promise<CoachBillingRow> {
  const row = await ensureBilling({ id: coachId });
  const d = await db();
  const set: Partial<CoachBillingRow> = { exempt, updatedAt: now };
  if (!exempt && !row.trialStart && !row.stripeSubscriptionId) {
    set.trialStart = now;
    set.trialEnd = addDays(now, TRIAL_DAYS);
    set.status = "TRIALING";
  }
  await d.update(coachBilling).set(set).where(eq(coachBilling.coachId, coachId));
  forget(coachId);
  return (await getBilling(coachId))!;
}

export async function activeClientCount(coachId: string): Promise<number> {
  const d = await db();
  const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "CLIENT"), eq(users.coachId, coachId), eq(users.active, true)));
  return Number(r.n);
}

const fields = (row: CoachBillingRow) => ({ exempt: row.exempt, status: row.status, trialEnd: row.trialEnd, periodEnd: row.periodEnd, hasSubscription: !!row.stripeSubscriptionId });

/* ---------------- What the app shows, and the pause ---------------- */
export async function billingInfo(me: UserRow): Promise<BillingInfo> {
  const enforced = billingEnforced();
  const base = { enforced, gst: taxOn(), stripeReady: stripeReady() };
  if (me.role === "CLIENT") {
    const coachId = me.coachId;
    const row = coachId && !(await coveredByGym(coachId)) ? await ensureBilling({ id: coachId }) : null;
    const status = row ? effectiveStatus(fields(row)) : "LIFETIME_FREE";
    const [coach] = coachId ? await (await db()).select({ name: users.name }).from(users).where(eq(users.id, coachId)).limit(1) : [];
    return {
      ...base,
      role: "CLIENT",
      exempt: status === "LIFETIME_FREE",
      status,
      blocked: enforced && isBlockedStatus(status),
      trialDaysLeft: 0,
      trialEnds: null,
      activeClients: 0,
      tierCents: 0,
      renewsOn: null,
      hasSubscription: false,
      cancelAtPeriodEnd: false,
      coachName: coach?.name?.split(" ")[0] ?? undefined,
    };
  }
  if (me.role === "COACH" && (await coveredByGym(me.id))) {
    const { gymPlanForUser } = await import("./gymPlan");
    const plan = await gymPlanForUser(me.id);
    return { ...base, role: "COACH", exempt: true, gym: true, ...(plan ? { gymPlan: plan } : {}), status: "LIFETIME_FREE", blocked: enforced && !!plan?.blocked, trialDaysLeft: 0, trialEnds: null, activeClients: await activeClientCount(me.id), tierCents: 0, renewsOn: null, hasSubscription: false, cancelAtPeriodEnd: false };
  }
  const row = await ensureBilling(me);
  const status = effectiveStatus(fields(row));
  const active = await activeClientCount(me.id);
  return {
    ...base,
    role: "COACH",
    exempt: status === "LIFETIME_FREE",
    status,
    blocked: enforced && isBlockedStatus(status),
    trialDaysLeft: row.stripeSubscriptionId ? 0 : trialDaysLeft(row.trialEnd),
    trialEnds: row.trialEnd?.toISOString() ?? null,
    activeClients: active,
    tierCents: tierFor(active),
    renewsOn: (row.periodEnd ?? (row.stripeSubscriptionId ? row.trialEnd : null))?.toISOString() ?? null,
    hasSubscription: !!row.stripeSubscriptionId,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

const blockedCache = new Map<string, { blocked: boolean; at: number }>();
const forget = (coachId: string) => void blockedCache.delete(coachId);
/** Tests only: drop the remembered pause status for a coach after changing their row directly. */
export const forgetBillingCache = forget;

/** Throws 402 when billing is enforced and this person's coach (or they, as a coach) have no trial or subscription. */
export async function assertBillingOk(me: UserRow): Promise<void> {
  if (!billingEnforced() || me.role === "OWNER") return;
  const coachId = me.role === "CLIENT" ? me.coachId : me.id;
  if (!coachId) return;
  const hit = blockedCache.get(coachId);
  let blocked: boolean;
  if (hit && Date.now() - hit.at < 20_000) blocked = hit.blocked;
  else {
    const row = await ensureBilling({ id: coachId });
    blocked = isBlockedStatus(effectiveStatus(fields(row))) && !(await coveredByGym(coachId));
    blockedCache.set(coachId, { blocked, at: Date.now() });
  }
  if (blocked) {
    throw new HttpError(402, me.role === "CLIENT" ? "Your coach's CoachFlow subscription has lapsed. Please contact your coach." : "Your CoachFlow subscription has ended. Subscribe to continue.");
  }
}

/* ---------------- Tier ---------------- */
export interface TierPreview {
  activeClients: number;
  tierCents: number;
  /** When the new price takes effect (the next renewal), if there is a subscription or a trial. */
  renewsOn: string | null;
  hasSubscription: boolean;
  exempt: boolean;
}

/** What the roster costs today and when that starts (database only, instant). */
export async function previewTier(coachId: string): Promise<TierPreview> {
  const row = await ensureBilling({ id: coachId });
  const active = await activeClientCount(coachId);
  return {
    activeClients: active,
    tierCents: tierFor(active),
    renewsOn: (row.periodEnd ?? row.trialEnd)?.toISOString() ?? null,
    hasSubscription: !!row.stripeSubscriptionId,
    exempt: row.exempt,
  };
}

/** The sentence shown after a client is added or removed. */
export function tierMessage(p: TierPreview, verb: "added" | "removed"): string | null {
  if (p.exempt) return null;
  const when = p.renewsOn ? new Date(p.renewsOn).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" }) : "your next renewal";
  return `Client ${verb}! Your active roster is now ${p.activeClients} client${p.activeClients === 1 ? "" : "s"}. Your subscription will adjust to ${sgd(p.tierCents)}/mo on your next renewal${p.renewsOn ? ` (${when})` : ""}.`;
}

const priceIds = new Map<number, string>();
async function priceIdFor(cents: number): Promise<string> {
  const hit = priceIds.get(cents);
  if (hit) return hit;
  const list = await stripe().prices.list({ lookup_keys: [lookupKey(cents)], active: true, limit: 1 });
  const id = list.data[0]?.id;
  if (!id) throw new HttpError(503, "Billing isn't fully set up yet (prices are missing). Please try again later.");
  priceIds.set(cents, id);
  return id;
}

/**
 * Keeps the Stripe subscription's price in step with the active roster. The change takes effect on the next renewal only (no
 * proration, no mid-month charge). Does nothing without a subscription (the trial has no price yet).
 */
export async function syncTier(coachId: string): Promise<{ changed: boolean; tierCents: number }> {
  const row = await getBilling(coachId);
  const cents = tierFor(await activeClientCount(coachId));
  if (!row || row.exempt || !row.stripeSubscriptionId || !stripeReady()) return { changed: false, tierCents: cents };
  if (row.tierCents === cents) return { changed: false, tierCents: cents };
  const s = stripe();
  const sub = await s.subscriptions.retrieve(row.stripeSubscriptionId);
  const item = sub.items.data[0];
  if (!item) return { changed: false, tierCents: cents };
  await s.subscriptions.update(row.stripeSubscriptionId, { items: [{ id: item.id, price: await priceIdFor(cents) }], proration_behavior: "none" });
  const d = await db();
  await d.update(coachBilling).set({ tierCents: cents, updatedAt: new Date() }).where(eq(coachBilling.coachId, coachId));
  return { changed: true, tierCents: cents };
}

/* ---------------- Checkout and the customer portal ---------------- */
export async function startCheckout(me: UserRow, origin: string): Promise<string> {
  if (me.role === "CLIENT") throw badRequest("Only coaches subscribe.");
  const row = await ensureBilling(me);
  if (row.exempt) throw badRequest("Your account has free lifetime access, so there is nothing to subscribe to.");
  if (await coveredByGym(me.id)) throw badRequest("Your gym covers your CoachFlow account, so there is nothing to subscribe to.");
  if (row.stripeSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(row.status)) throw badRequest("You already have a subscription. Use Manage Subscription & Billing to change it.");
  const cents = tierFor(await activeClientCount(me.id));
  const price = await priceIdFor(cents);
  // What is left of the free trial carries over (Stripe needs at least two days to schedule it, otherwise the first charge is today).
  const left = row.trialEnd && row.status === "TRIALING" ? row.trialEnd : null;
  const carry = left && left.getTime() - Date.now() >= 2 * 86_400_000 + 60_000 ? Math.floor(left.getTime() / 1000) : undefined;
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    ...(row.stripeCustomerId ? { customer: row.stripeCustomerId, customer_update: { address: "auto", name: "auto" } } : { customer_email: me.email ?? undefined }),
    subscription_data: { ...(carry ? { trial_end: carry } : {}), metadata: { coachId: me.id } },
    metadata: { coachId: me.id },
    client_reference_id: me.id,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    automatic_tax: { enabled: taxOn() },
    success_url: `${origin}/trainer?billing=success`,
    cancel_url: `${origin}/settings?billing=cancelled`,
  });
  if (!session.url) throw new HttpError(502, "Stripe didn't return a checkout page. Please try again.");
  return session.url;
}

export async function openPortal(me: UserRow, origin: string): Promise<string> {
  if (me.role === "CLIENT") throw badRequest("Only coaches manage a subscription.");
  const row = await ensureBilling(me);
  if (!row.stripeCustomerId) throw badRequest("You don't have a subscription yet. Subscribe first.");
  const session = await stripe().billingPortal.sessions.create({ customer: row.stripeCustomerId, return_url: `${origin}/settings` });
  return session.url;
}

/* ---------------- Stripe webhooks ---------------- */
const ourStatus = (s: string): string | null =>
  s === "trialing" ? "TRIALING" : s === "active" ? "ACTIVE" : s === "past_due" || s === "unpaid" ? "PAST_DUE" : s === "canceled" ? "CANCELED" : null;

async function coachIdFor(obj: { metadata?: Record<string, string> | null; customer?: unknown }): Promise<string | null> {
  const fromMeta = obj.metadata?.coachId;
  if (fromMeta) return fromMeta;
  const cust = typeof obj.customer === "string" ? obj.customer : (obj.customer as { id?: string } | null)?.id;
  if (!cust) return null;
  const d = await db();
  const [row] = await d.select({ coachId: coachBilling.coachId }).from(coachBilling).where(eq(coachBilling.stripeCustomerId, cust)).limit(1);
  return row?.coachId ?? null;
}

const idOf = (v: unknown): string | null => (typeof v === "string" ? v : ((v as { id?: string } | null)?.id ?? null));
const asDate = (unix?: number | null): Date | null => (unix ? new Date(unix * 1000) : null);

/** Applies one verified Stripe event. Safe to receive more than once. Returns whether it was one we act on. */
export async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  // A gym's subscription (its id is in the event's metadata, or the customer is a gym's) is handled in gymPlan.ts.
  const { handleGymEvent } = await import("./gymPlan");
  const gymResult = await handleGymEvent(event);
  if (gymResult !== null) return gymResult;
  // A consult payment (metadata.kind = "consult") is handled in consult.ts.
  const { handleConsultEvent } = await import("./consult");
  const consultResult = await handleConsultEvent(event);
  if (consultResult !== null) return consultResult;
  const d = await db();
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode !== "subscription") return false;
      const coachId = await coachIdFor(s as unknown as { metadata?: Record<string, string> });
      if (!coachId) return false;
      await ensureBilling({ id: coachId });
      await d
        .update(coachBilling)
        .set({ exempt: false, stripeCustomerId: idOf(s.customer), stripeSubscriptionId: idOf(s.subscription), status: "ACTIVE", updatedAt: new Date() })
        .where(eq(coachBilling.coachId, coachId));
      forget(coachId);
      return true;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const coachId = await coachIdFor(sub as unknown as { metadata?: Record<string, string>; customer?: unknown });
      if (!coachId) return false;
      const status = ourStatus(sub.status);
      const item = sub.items.data[0];
      await ensureBilling({ id: coachId });
      await d
        .update(coachBilling)
        .set({
          stripeCustomerId: idOf(sub.customer),
          stripeSubscriptionId: sub.id,
          ...(status ? { status } : {}),
          ...(item?.price?.unit_amount ? { tierCents: item.price.unit_amount } : {}),
          periodEnd: asDate(item?.current_period_end),
          trialEnd: sub.trial_end ? asDate(sub.trial_end) : undefined,
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
          updatedAt: new Date(),
        })
        .where(eq(coachBilling.coachId, coachId));
      forget(coachId);
      // Stripe says "active" once the first real payment went through: the coach who invited this one earns their free month.
      if (sub.status === "active") {
        const { onCoachPaid } = await import("./referrals");
        await onCoachPaid(coachId);
        // A discount earned from the monthly AI review before they subscribed goes onto their account now.
        try {
          const { applyPendingReviewCredits } = await import("./aiReview");
          await applyPendingReviewCredits(coachId);
        } catch (e) {
          console.error("pending review credit", e instanceof Error ? e.message : e);
        }
      }
      return true;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const coachId = await coachIdFor(sub as unknown as { metadata?: Record<string, string>; customer?: unknown });
      if (!coachId) return false;
      await d.update(coachBilling).set({ status: "CANCELED", periodEnd: new Date(), cancelAtPeriodEnd: false, updatedAt: new Date() }).where(eq(coachBilling.coachId, coachId));
      forget(coachId);
      return true;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const coachId = await coachIdFor(inv as unknown as { metadata?: Record<string, string>; customer?: unknown });
      if (!coachId) return false;
      await d.update(coachBilling).set({ status: "PAST_DUE", updatedAt: new Date() }).where(eq(coachBilling.coachId, coachId));
      forget(coachId);
      return true;
    }
    case "invoice.upcoming": {
      // A few days before each renewal: make sure the price matches the roster as it is now.
      const inv = event.data.object as Stripe.Invoice;
      const coachId = await coachIdFor(inv as unknown as { metadata?: Record<string, string>; customer?: unknown });
      if (!coachId) return false;
      await syncTier(coachId);
      return true;
    }
    default:
      return false;
  }
}

/* ---------------- Trial reminder emails (daily) ---------------- */
function reminderMail(name: string, days: number, cents: number, clients: number, origin: string, gst: boolean) {
  const when = days <= 1 ? "tomorrow" : `in ${days} days`;
  const price = `${sgd(cents)}/mo${gst ? " + GST" : ""}`;
  const link = `${origin}/settings`;
  return {
    subject: days <= 1 ? "Your CoachFlow free trial ends tomorrow" : `Your CoachFlow free trial ends in ${days} days`,
    text: `Hi ${name},\n\nYour 30-day CoachFlow free trial ends ${when}. To keep coaching your ${clients} active client${clients === 1 ? "" : "s"}, subscribe for ${price}.\n\nSubscribe here: ${link}\n\nYour clients and workout history stay safe either way.`,
    html: layout(
      `Your free trial ends ${when}`,
      `<p style="margin:0 0 12px;color:#E8ECF4;">Hi ${escapeHtml(name)}, your 30-day CoachFlow free trial ends <strong>${escapeHtml(when)}</strong>.</p>
       <p style="margin:0 0 12px;color:#E8ECF4;">To keep coaching your ${clients} active client${clients === 1 ? "" : "s"}, subscribe for <strong>${escapeHtml(price)}</strong>.</p>
       <p style="margin:0;color:#8892A6;font-size:13px;">Your clients and workout history stay safe either way.</p>`,
      { label: "Subscribe to CoachFlow", href: link },
    ),
  };
}

/** Emails coaches whose free trial ends in a week or tomorrow (each is sent once). Run daily by the scheduled job. */
export async function sendTrialReminders(origin: string, now = new Date()): Promise<{ week: number; day: number }> {
  const d = await db();
  const rows = await d
    .select()
    .from(coachBilling)
    .where(and(eq(coachBilling.exempt, false), eq(coachBilling.status, "TRIALING"), isNull(coachBilling.stripeSubscriptionId)));
  let week = 0;
  let day = 0;
  for (const r of rows) {
    if (!r.trialEnd || (await coveredByGym(r.coachId))) continue;
    const left = Math.ceil((r.trialEnd.getTime() - now.getTime()) / 86_400_000);
    if (left < 1) continue; // already over
    const sendNow = left <= 1 && !r.warned1 ? "1" : left <= 7 && !r.warned7 ? "7" : null;
    if (!sendNow) continue;
    const [coach] = await d.select().from(users).where(eq(users.id, r.coachId)).limit(1);
    if (!coach?.email) continue;
    const clients = await activeClientCount(r.coachId);
    const mail = reminderMail((coach.name ?? "there").split(" ")[0], left, tierFor(clients), clients, origin, taxOn());
    const res = await sendMail({ to: coach.email, ...mail }).catch(() => null);
    if (!res || res.status === "failed") continue;
    // A coach who joins with fewer than 7 days left gets only the final reminder; both flags are then done.
    await d
      .update(coachBilling)
      .set(sendNow === "1" ? { warned1: true, warned7: true, updatedAt: now } : { warned7: true, updatedAt: now })
      .where(eq(coachBilling.coachId, r.coachId));
    if (sendNow === "1") day++;
    else week++;
  }
  return { week, day };
}

/* ---------------- Owner overview ---------------- */
export interface CoachBillingLine {
  coachId: string;
  name: string;
  email: string;
  role: "OWNER" | "COACH";
  status: BillingStatus;
  exempt: boolean;
  activeClients: number;
  tierCents: number;
  renewsOn: string | null;
  trialDaysLeft: number;
  hasSubscription: boolean;
}

export async function billingOverview(): Promise<{ coaches: CoachBillingLine[]; totals: { subscribed: number; trials: number; mrrCents: number } }> {
  const d = await db();
  const staff = await d.select().from(users).where(sql`${users.role} IN ('OWNER','COACH')`);
  const lines: CoachBillingLine[] = [];
  for (const u of staff) {
    const row = u.role === "OWNER" ? await markOwner(u.id) : await ensureBilling({ id: u.id });
    const status = effectiveStatus(fields(row));
    const active = await activeClientCount(u.id);
    lines.push({
      coachId: u.id,
      name: u.name ?? u.username,
      email: u.email ?? "",
      role: u.role as "OWNER" | "COACH",
      status,
      exempt: status === "LIFETIME_FREE",
      activeClients: active,
      tierCents: row.stripeSubscriptionId ? row.tierCents : tierFor(active),
      renewsOn: (row.periodEnd ?? (row.stripeSubscriptionId ? row.trialEnd : null))?.toISOString() ?? null,
      trialDaysLeft: row.stripeSubscriptionId ? 0 : trialDaysLeft(row.trialEnd),
      hasSubscription: !!row.stripeSubscriptionId,
    });
  }
  const paying = lines.filter((l) => l.hasSubscription && (l.status === "ACTIVE" || l.status === "PAST_DUE") && !l.exempt);
  return {
    coaches: lines,
    totals: {
      subscribed: lines.filter((l) => l.hasSubscription && !l.exempt && l.status !== "CANCELED" && l.status !== "EXPIRED").length,
      trials: lines.filter((l) => !l.exempt && l.status === "TRIALING" && l.trialDaysLeft > 0).length,
      mrrCents: paying.reduce((n, l) => n + l.tierCents, 0),
    },
  };
}

/** The owner is always exempt, whatever their row says. */
async function markOwner(id: string): Promise<CoachBillingRow> {
  const row = await ensureBilling({ id });
  if (row.exempt) return row;
  await setExempt(id, true);
  return (await getBilling(id))!;
}
