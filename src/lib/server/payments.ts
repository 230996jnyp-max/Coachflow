import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Stripe from "stripe";
import { CURRENCY, MANUAL_KINDS, cleanPackage, cleanPayNow, refFrom, sgd, type OrderMethod, type OrderStatus } from "@/lib/payments";
import { isMinorRow, loadClientFor, openProfile, sealProfile } from "./accounts";
import { decryptJson, encryptJson } from "./crypto";
import { logCredit } from "./credits";
import { db, isLocalTestMode } from "./db";
import { HttpError, badRequest, conflict, forbidden, notFound } from "./http";
import { notify } from "./groups";
import { adjustCredits, adjustGroupCredits } from "./schedule";
import { paymentEvents, paymentOrders, paymentPackages, paymentSettings, users, type PaymentOrderRow, type PaymentPackageRow, type PaymentSettingsRow, type UserRow } from "./schema";

/*
 * Payments between a coach and their clients. The money goes straight from the client to the coach: through the coach's own Stripe
 * account (Connect, Standard accounts, "direct charges", with an application fee of 0, so the platform takes nothing), or by PayNow or
 * cash that the coach confirms. This code never holds money. It keeps the records, adds the credits when a payment is confirmed (once
 * only, however many times Stripe repeats itself) and takes them back, up to what is left, on a refund.
 */

const aadNote = (id: string) => `payment-note:${id}`;
const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
const LINK_DAYS = 14;

/* ---------------- Stripe ---------------- */
let client: Stripe | null = null;
export const paymentsReady = (): boolean => !!process.env.STRIPE_SECRET_KEY;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(503, "Card payments aren't set up on this server yet.");
  if (!client) {
    // Local testing only: talk to a stand-in Stripe (host:port) instead of the real one.
    const fake = process.env.PAYMENTS_FAKE_STRIPE;
    if (fake && isLocalTestMode()) {
      const [host, port] = fake.split(":");
      client = new Stripe(key, { host, port: Number(port), protocol: "http" });
    } else client = new Stripe(key);
  }
  return client;
}

const nameOf = (u: UserRow): string => {
  try {
    return (u.role === "CLIENT" ? openProfile(u).name : (u.name ?? u.username)).trim() || "Someone";
  } catch {
    return "Someone";
  }
};
const firstOf = (u: UserRow) => nameOf(u).split(/\s+/)[0];

/* ---------------- A coach's payment settings and Stripe account ---------------- */
export interface PaymentState {
  /** Card payments are set up on the server at all. */
  serverReady: boolean;
  connected: boolean;
  /** The coach can take card and PayNow payments through Stripe right now. */
  stripeReady: boolean;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  paynow: string | null;
}

const stateOf = (row: PaymentSettingsRow | undefined): PaymentState => ({
  serverReady: paymentsReady(),
  connected: !!row?.stripeAccountId,
  stripeReady: paymentsReady() && !!row?.stripeAccountId && row.chargesEnabled,
  detailsSubmitted: !!row?.detailsSubmitted,
  payoutsEnabled: !!row?.payoutsEnabled,
  paynow: row?.paynow ?? null,
});

async function settingsOf(coachId: string): Promise<PaymentSettingsRow | undefined> {
  const d = await db();
  const [row] = await d.select().from(paymentSettings).where(eq(paymentSettings.coachId, coachId)).limit(1);
  return row;
}

function requireCoach(u: UserRow): void {
  if (u.role === "CLIENT") throw forbidden("Only a coach can do that.");
}

export async function paymentState(coach: UserRow, opts: { refresh?: boolean } = {}): Promise<PaymentState> {
  requireCoach(coach);
  let row = await settingsOf(coach.id);
  if (opts.refresh && row?.stripeAccountId && paymentsReady()) row = (await syncAccount(coach.id, row.stripeAccountId)) ?? row;
  return stateOf(row);
}

/** Reads the coach's Stripe account and keeps the three flags that matter. */
async function syncAccount(coachId: string, accountId: string): Promise<PaymentSettingsRow | undefined> {
  const a = await stripe().accounts.retrieve(accountId);
  const d = await db();
  const [row] = await d
    .update(paymentSettings)
    .set({ chargesEnabled: !!a.charges_enabled, detailsSubmitted: !!a.details_submitted, payoutsEnabled: !!a.payouts_enabled, updatedAt: new Date() })
    .where(and(eq(paymentSettings.coachId, coachId), eq(paymentSettings.stripeAccountId, accountId)))
    .returning();
  return row;
}

/** Starts (or resumes) the coach connecting their own Stripe account. Returns the Stripe page they continue on. */
export async function startConnect(coach: UserRow, origin: string): Promise<string> {
  requireCoach(coach);
  if (!paymentsReady()) throw new HttpError(503, "Card payments aren't set up on this server yet.");
  const d = await db();
  let row = await settingsOf(coach.id);
  let accountId = row?.stripeAccountId ?? null;
  if (!accountId) {
    // A Standard account: the coach owns it, signs in to Stripe themselves, handles their own refunds and disputes, and Stripe bills them directly.
    const acct = await stripe().accounts.create({ type: "standard", country: "SG", ...(coach.email ? { email: coach.email } : {}), metadata: { coachflow_coach: coach.id } });
    accountId = acct.id;
    if (row) await d.update(paymentSettings).set({ stripeAccountId: accountId, updatedAt: new Date() }).where(eq(paymentSettings.coachId, coach.id));
    else await d.insert(paymentSettings).values({ coachId: coach.id, stripeAccountId: accountId });
    row = await settingsOf(coach.id);
  }
  const link = await stripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${origin}/settings/payments?refresh=1`,
    return_url: `${origin}/settings/payments?return=1`,
  });
  return link.url;
}

/** Forgets the link to the coach's Stripe account here. The Stripe account itself stays theirs and untouched. */
export async function disconnect(coach: UserRow): Promise<void> {
  requireCoach(coach);
  const d = await db();
  const open = await d.select({ id: paymentOrders.id }).from(paymentOrders).where(and(eq(paymentOrders.coachId, coach.id), eq(paymentOrders.method, "STRIPE"), inArray(paymentOrders.status, ["PENDING"]), sql`${paymentOrders.stripeSessionId} is not null`)).limit(1);
  if (open.length) throw conflict("A payment is still open. Cancel it or wait for it to finish first.");
  await d.update(paymentSettings).set({ stripeAccountId: null, chargesEnabled: false, detailsSubmitted: false, payoutsEnabled: false, updatedAt: new Date() }).where(eq(paymentSettings.coachId, coach.id));
}

export async function setPayNow(coach: UserRow, raw: unknown): Promise<PaymentState> {
  requireCoach(coach);
  const d = await db();
  const empty = raw === null || (typeof raw === "string" && raw.trim() === "");
  let value: string | null = null;
  if (!empty) {
    const c = cleanPayNow(raw);
    if (!c.ok) throw badRequest(c.error);
    value = c.value;
  }
  const row = await settingsOf(coach.id);
  if (row) await d.update(paymentSettings).set({ paynow: value, updatedAt: new Date() }).where(eq(paymentSettings.coachId, coach.id));
  else await d.insert(paymentSettings).values({ coachId: coach.id, paynow: value });
  return stateOf(await settingsOf(coach.id));
}

/* ---------------- Packages ---------------- */
export interface PackageRec {
  id: string;
  name: string;
  sessions: number;
  groupCredits: number;
  priceCents: number;
  active: boolean;
}
const toPackage = (r: PaymentPackageRow): PackageRec => ({ id: r.id, name: r.name, sessions: r.sessions, groupCredits: r.groupCredits, priceCents: r.priceCents, active: r.active });

export async function listPackages(coachId: string, onlyActive = false): Promise<PackageRec[]> {
  const d = await db();
  const rows = await d.select().from(paymentPackages).where(onlyActive ? and(eq(paymentPackages.coachId, coachId), eq(paymentPackages.active, true)) : eq(paymentPackages.coachId, coachId)).orderBy(paymentPackages.priceCents);
  return rows.map(toPackage);
}

export async function savePackage(coach: UserRow, raw: unknown, id?: string): Promise<PackageRec> {
  requireCoach(coach);
  const c = cleanPackage(raw);
  if (!c.ok) throw badRequest(c.error);
  const d = await db();
  const active = raw && typeof raw === "object" && (raw as Record<string, unknown>).active === false ? false : true;
  if (id) {
    const [row] = await d.update(paymentPackages).set({ name: c.name, sessions: c.sessions, groupCredits: c.groupCredits, priceCents: c.priceCents, active }).where(and(eq(paymentPackages.id, id), eq(paymentPackages.coachId, coach.id))).returning();
    if (!row) throw notFound("That package wasn't found.");
    return toPackage(row);
  }
  const mine = await d.select({ id: paymentPackages.id }).from(paymentPackages).where(eq(paymentPackages.coachId, coach.id));
  if (mine.length >= 30) throw badRequest("You can keep up to 30 packages. Remove one you no longer sell first.");
  const [row] = await d.insert(paymentPackages).values({ id: newId("pk"), coachId: coach.id, name: c.name, sessions: c.sessions, groupCredits: c.groupCredits, priceCents: c.priceCents, active }).returning();
  return toPackage(row);
}

/** A package is only ever switched off, never deleted: payments already made keep their own copy of it either way. */
export async function removePackage(coach: UserRow, id: string): Promise<void> {
  requireCoach(coach);
  const d = await db();
  const [row] = await d.update(paymentPackages).set({ active: false }).where(and(eq(paymentPackages.id, id), eq(paymentPackages.coachId, coach.id))).returning({ id: paymentPackages.id });
  if (!row) throw notFound("That package wasn't found.");
}

/* ---------------- Orders ---------------- */
export interface OrderRec {
  id: string;
  token: string;
  ref: string;
  clientId: string;
  clientName: string;
  name: string;
  sessions: number;
  groupCredits: number;
  amountCents: number;
  method: OrderMethod;
  manualKind: string | null;
  status: OrderStatus;
  receiptUrl: string | null;
  note: string;
  createdBy: "COACH" | "CLIENT";
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  expired: boolean;
}

function toOrder(r: PaymentOrderRow, names: Map<string, string>, withNote: boolean): OrderRec {
  let note = "";
  if (withNote && r.noteEnc) {
    try {
      note = decryptJson<{ note: string }>(r.noteEnc, aadNote(r.id)).note ?? "";
    } catch {
      note = "";
    }
  }
  return {
    id: r.id,
    token: r.token,
    ref: r.ref,
    clientId: r.clientId,
    clientName: names.get(r.clientId) ?? "Deleted client",
    name: r.name,
    sessions: r.sessions,
    groupCredits: r.groupCredits,
    amountCents: r.amountCents,
    method: r.method as OrderMethod,
    manualKind: r.manualKind,
    status: r.status as OrderStatus,
    receiptUrl: r.receiptUrl,
    note,
    createdBy: r.createdBy === "CLIENT" ? "CLIENT" : "COACH",
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    refundedAt: r.refundedAt ? r.refundedAt.toISOString() : null,
    expired: (r.status === "PENDING" || r.status === "AWAITING") && !!r.expiresAt && r.expiresAt.getTime() < Date.now(),
  };
}

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const d = await db();
  for (const u of await d.select().from(users).where(inArray(users.id, [...new Set(ids)]))) out.set(u.id, nameOf(u));
  return out;
}

async function newOrder(coach: UserRow, client: UserRow, pkg: { id: string | null; name: string; sessions: number; groupCredits: number; amountCents: number }, extra: Partial<typeof paymentOrders.$inferInsert> = {}): Promise<PaymentOrderRow> {
  const d = await db();
  const id = newId("po");
  const [row] = await d
    .insert(paymentOrders)
    .values({
      id,
      token: randomBytes(18).toString("base64url"),
      ref: refFrom(id),
      coachId: coach.id,
      clientId: client.id,
      packageId: pkg.id,
      name: pkg.name,
      sessions: pkg.sessions,
      groupCredits: pkg.groupCredits,
      amountCents: pkg.amountCents,
      currency: CURRENCY,
      expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000),
      ...extra,
    })
    .returning();
  return row;
}

async function activePackage(coachId: string, packageId: unknown): Promise<PaymentPackageRow> {
  if (typeof packageId !== "string") throw badRequest("Choose a package.");
  const d = await db();
  const [pkg] = await d.select().from(paymentPackages).where(and(eq(paymentPackages.id, packageId), eq(paymentPackages.coachId, coachId), eq(paymentPackages.active, true))).limit(1);
  if (!pkg) throw notFound("That package isn't available.");
  return pkg;
}

/** What a client sees when they open "Buy a package": their coach's active packages and which ways of paying are switched on. */
export async function buyOptions(client: UserRow): Promise<{ coachName: string; packages: PackageRec[]; stripeReady: boolean; paynow: string | null; minor: boolean } | null> {
  if (client.role !== "CLIENT" || !client.coachId) return null;
  const d = await db();
  const [coach] = await d.select().from(users).where(eq(users.id, client.coachId)).limit(1);
  if (!coach) return null;
  const st = stateOf(await settingsOf(coach.id));
  const packages = await listPackages(coach.id, true);
  if (!packages.length || (!st.stripeReady && !st.paynow)) return null;
  return { coachName: nameOf(coach), packages, stripeReady: st.stripeReady, paynow: st.paynow, minor: isMinorRow(client) };
}

/**
 * A client buys a package for themselves (an adult, with a coach who has payments switched on). Returns the Stripe page when card
 * payments are on, and always the pay page (`path`), which also offers PayNow when the coach has given a number.
 */
export async function buyAsClient(client: UserRow, packageId: unknown, origin: string): Promise<{ orderId: string; url: string | null; path: string }> {
  if (client.role !== "CLIENT" || !client.coachId) throw forbidden("Only a client with a coach can buy a package.");
  if (isMinorRow(client)) throw forbidden("Under 18: ask your coach to send a payment link for a parent or guardian.");
  const d = await db();
  const [coach] = await d.select().from(users).where(eq(users.id, client.coachId)).limit(1);
  if (!coach) throw notFound();
  const pkg = await activePackage(coach.id, packageId);
  const st = stateOf(await settingsOf(coach.id));
  if (!st.stripeReady && !st.paynow) throw badRequest("Your coach hasn't switched on payments in the app yet. Ask them how to pay.");
  const order = await newOrder(coach, client, { id: pkg.id, name: pkg.name, sessions: pkg.sessions, groupCredits: pkg.groupCredits, amountCents: pkg.priceCents }, { createdBy: "CLIENT" });
  const url = st.stripeReady ? await startCheckout(order, origin, client) : null;
  return { orderId: order.id, url, path: `/pay/${order.token}` };
}

/** A coach makes a pay link for a client (for a parent or guardian too: the link needs no account). */
export async function createPayLink(coach: UserRow, clientId: unknown, packageId: unknown): Promise<{ order: OrderRec; path: string }> {
  requireCoach(coach);
  if (typeof clientId !== "string") throw badRequest("Choose a client.");
  const client = await loadClientFor(coach, clientId);
  if (!client || !client.active) throw notFound("Client not found.");
  const pkg = await activePackage(coach.id, packageId);
  const st = stateOf(await settingsOf(coach.id));
  if (!st.stripeReady && !st.paynow) throw badRequest("Switch on card payments or add your PayNow number first (Settings, Payments).");
  const row = await newOrder(coach, client, { id: pkg.id, name: pkg.name, sessions: pkg.sessions, groupCredits: pkg.groupCredits, amountCents: pkg.priceCents });
  return { order: toOrder(row, await namesFor([client.id]), true), path: `/pay/${row.token}` };
}

/** Creates the Stripe Checkout page for an order, on the coach's own account (an application fee of 0), or reuses one still open. */
async function startCheckout(order: PaymentOrderRow, origin: string, client?: UserRow): Promise<string> {
  const d = await db();
  const st = await settingsOf(order.coachId);
  if (!st?.stripeAccountId || !st.chargesEnabled || !paymentsReady()) throw badRequest("Card payments aren't available for this coach right now.");
  if (order.status === "PAID" || order.status === "REFUNDED") throw conflict("This payment is already done.");
  if (order.expiresAt && order.expiresAt.getTime() < Date.now()) throw new HttpError(410, "This payment link has expired. Ask your coach for a new one.");
  const acct = st.stripeAccountId;
  if (order.stripeSessionId) {
    try {
      const s = await stripe().checkout.sessions.retrieve(order.stripeSessionId, {}, { stripeAccount: acct });
      if (s.status === "open" && s.url) return s.url;
    } catch {
      /* make a new one */
    }
  }
  let email: string | undefined;
  if (client) {
    try {
      email = openProfile(client).email || undefined;
    } catch {
      email = undefined;
    }
  }
  const [coach] = await d.select().from(users).where(eq(users.id, order.coachId)).limit(1);
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: order.currency, unit_amount: order.amountCents, product_data: { name: order.name } } }],
      client_reference_id: order.id,
      ...(email ? { customer_email: email } : {}),
      metadata: { order_id: order.id, coach_id: order.coachId },
      payment_intent_data: { metadata: { order_id: order.id }, description: `${coach ? nameOf(coach) : "Coach"}: ${order.name}` },
      success_url: `${origin}/pay/${order.token}?paid=1`,
      cancel_url: `${origin}/pay/${order.token}`,
    },
    { stripeAccount: acct, idempotencyKey: `co_${order.id}_${Date.now().toString(36)}` },
  );
  if (!session.url) throw new HttpError(502, "Stripe didn't return a payment page. Please try again.");
  await d.update(paymentOrders).set({ stripeSessionId: session.id, method: "STRIPE" }).where(and(eq(paymentOrders.id, order.id), inArray(paymentOrders.status, ["PENDING", "AWAITING"])));
  return session.url;
}

/* ---------------- The public pay page (no account needed) ---------------- */
export interface PublicOrder {
  coachName: string;
  clientFirstName: string;
  name: string;
  sessions: number;
  groupCredits: number;
  amountCents: number;
  status: OrderStatus;
  expired: boolean;
  stripeReady: boolean;
  paynow: string | null;
  ref: string;
}

async function byToken(token: string): Promise<PaymentOrderRow> {
  if (typeof token !== "string" || token.length < 10 || token.length > 60) throw notFound("That payment link isn't valid.");
  const d = await db();
  const [row] = await d.select().from(paymentOrders).where(eq(paymentOrders.token, token)).limit(1);
  if (!row) throw notFound("That payment link isn't valid.");
  return row;
}

export async function publicOrder(token: string): Promise<PublicOrder> {
  const r = await byToken(token);
  const d = await db();
  const [coach] = await d.select().from(users).where(eq(users.id, r.coachId)).limit(1);
  const [cl] = await d.select().from(users).where(eq(users.id, r.clientId)).limit(1);
  const st = stateOf(await settingsOf(r.coachId));
  return {
    coachName: coach ? nameOf(coach) : "Your coach",
    clientFirstName: cl ? firstOf(cl) : "",
    name: r.name,
    sessions: r.sessions,
    groupCredits: r.groupCredits,
    amountCents: r.amountCents,
    status: r.status as OrderStatus,
    expired: (r.status === "PENDING" || r.status === "AWAITING") && !!r.expiresAt && r.expiresAt.getTime() < Date.now(),
    stripeReady: st.stripeReady,
    paynow: st.paynow,
    ref: r.ref,
  };
}

/** The payer chose to pay by card or PayNow through Stripe. Returns the Stripe page. */
export async function payByLink(token: string, origin: string): Promise<string> {
  const r = await byToken(token);
  const d = await db();
  const [cl] = await d.select().from(users).where(eq(users.id, r.clientId)).limit(1);
  return startCheckout(r, origin, cl);
}

/** The payer says they sent the PayNow transfer. The coach still has to confirm they received it before any credits are added. */
export async function claimPayNow(token: string): Promise<void> {
  const r = await byToken(token);
  if (r.status === "PAID" || r.status === "REFUNDED") throw conflict("This payment is already done.");
  if (r.expiresAt && r.expiresAt.getTime() < Date.now()) throw new HttpError(410, "This payment link has expired. Ask your coach for a new one.");
  const st = await settingsOf(r.coachId);
  if (!st?.paynow) throw badRequest("This coach doesn't take PayNow payments.");
  const d = await db();
  const [u] = await d.update(paymentOrders).set({ method: "PAYNOW", status: "AWAITING" }).where(and(eq(paymentOrders.id, r.id), inArray(paymentOrders.status, ["PENDING", "AWAITING", "CANCELLED"]))).returning();
  if (!u) return;
  const [cl] = await d.select().from(users).where(eq(users.id, r.clientId)).limit(1);
  await notify([r.coachId], "payment_claimed", { title: `${cl ? firstOf(cl) : "A client"} says they paid by PayNow`, body: `${sgd(r.amountCents)} for ${r.name}, reference ${r.ref}. Check your bank, then confirm it so their credits are added.`, link: "/settings/payments", about: r.clientId }, { email: false });
}

/* ---------------- Marking paid, and adding the credits (exactly once) ---------------- */
interface PaidVia {
  method: OrderMethod;
  paymentIntentId?: string | null;
  receiptUrl?: string | null;
  manualKind?: string | null;
}

/**
 * Turns an order into PAID and adds the credits, once. The status change is a single guarded UPDATE, so two webhooks (or a webhook and
 * a coach's tap) arriving together can't both add them.
 */
export async function markPaid(orderId: string, via: PaidVia): Promise<{ changed: boolean; order: PaymentOrderRow | null }> {
  const d = await db();
  const [claimed] = await d
    .update(paymentOrders)
    .set({ status: "PAID", paidAt: new Date(), method: via.method, ...(via.paymentIntentId ? { paymentIntentId: via.paymentIntentId } : {}), ...(via.receiptUrl ? { receiptUrl: via.receiptUrl } : {}), ...(via.manualKind ? { manualKind: via.manualKind } : {}) })
    .where(and(eq(paymentOrders.id, orderId), inArray(paymentOrders.status, ["PENDING", "AWAITING", "CANCELLED"])))
    .returning();
  if (!claimed) {
    const [cur] = await d.select().from(paymentOrders).where(eq(paymentOrders.id, orderId)).limit(1);
    return { changed: false, order: cur ?? null };
  }
  const [clientRow] = await d.select().from(users).where(eq(users.id, claimed.clientId)).limit(1);
  const [coachRow] = await d.select().from(users).where(eq(users.id, claimed.coachId)).limit(1);
  let appliedS = 0;
  let appliedG = 0;
  if (clientRow && clientRow.role === "CLIENT") {
    if (claimed.sessions > 0) {
      const before = openProfile(clientRow).credits;
      const after = await adjustCredits(clientRow, claimed.sessions);
      appliedS = after - before;
      const fresh = (await d.select().from(users).where(eq(users.id, clientRow.id)).limit(1))[0];
      if (fresh) {
        const p = openProfile(fresh);
        p.packageSize = p.credits; // a new package starts full
        await d.update(users).set({ profileEnc: sealProfile(fresh.id, p), updatedAt: new Date() }).where(eq(users.id, fresh.id));
      }
      await logCredit({ clientId: clientRow.id, coachId: claimed.coachId, pool: "SESSION", kind: "ADJUSTMENT", delta: appliedS, sessionType: "1-on-1 PT", label: `Bought: ${claimed.name}`, balance: after });
    }
    if (claimed.groupCredits > 0) {
      const fresh2 = (await d.select().from(users).where(eq(users.id, clientRow.id)).limit(1))[0] ?? clientRow;
      const before = openProfile(fresh2).groupClassCredits ?? 0;
      const after = await adjustGroupCredits(fresh2, claimed.groupCredits);
      appliedG = after - before;
      await logCredit({ clientId: clientRow.id, coachId: claimed.coachId, pool: "GROUP", kind: "ADJUSTMENT", delta: appliedG, sessionType: "Group class", label: `Bought: ${claimed.name}`, balance: after });
    }
  }
  const [done] = await d.update(paymentOrders).set({ appliedSessions: appliedS, appliedGroup: appliedG }).where(eq(paymentOrders.id, claimed.id)).returning();
  const who = clientRow ? firstOf(clientRow) : "A client";
  await notify([claimed.coachId], "payment_received", { title: `${who} paid ${sgd(claimed.amountCents)}`, body: `${claimed.name}${claimed.sessions ? `: ${claimed.sessions} session${claimed.sessions === 1 ? "" : "s"} added` : ""}${claimed.groupCredits ? `, ${claimed.groupCredits} group class credit${claimed.groupCredits === 1 ? "" : "s"} added` : ""}.`, link: `/clients/${claimed.clientId}`, about: claimed.clientId }, { email: false });
  if (clientRow && via.method !== "MANUAL")
    await notify([claimed.clientId], "payment_receipt", { title: "Payment received", body: `${coachRow ? nameOf(coachRow) : "Your coach"} received your ${sgd(claimed.amountCents)} payment for ${claimed.name}. Your credits have been added.`, link: "/pay" }, { email: false });
  return { changed: true, order: done ?? claimed };
}

/** The coach records a payment they received themselves (cash, a bank transfer, a PayNow they saw arrive): added at once. */
export async function recordManual(coach: UserRow, input: Record<string, unknown>): Promise<OrderRec> {
  requireCoach(coach);
  if (typeof input.clientId !== "string") throw badRequest("Choose a client.");
  const client = await loadClientFor(coach, input.clientId);
  if (!client || !client.active) throw notFound("Client not found.");
  const kind = (MANUAL_KINDS as readonly string[]).includes(String(input.kind)) ? String(input.kind) : "Other";
  let spec: { id: string | null; name: string; sessions: number; groupCredits: number; amountCents: number };
  if (typeof input.packageId === "string" && input.packageId) {
    const d = await db();
    const [pkg] = await d.select().from(paymentPackages).where(and(eq(paymentPackages.id, input.packageId), eq(paymentPackages.coachId, coach.id))).limit(1);
    if (!pkg) throw notFound("That package wasn't found.");
    spec = { id: pkg.id, name: pkg.name, sessions: pkg.sessions, groupCredits: pkg.groupCredits, amountCents: pkg.priceCents };
  } else {
    // Something that isn't one of your packages: a name, the credits, and what was paid.
    const c = cleanPackage({ name: input.name, sessions: input.sessions, groupCredits: input.groupCredits, price: input.price });
    if (!c.ok) throw badRequest(c.error);
    spec = { id: null, name: c.name, sessions: c.sessions, groupCredits: c.groupCredits, amountCents: c.priceCents };
  }
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";
  const row = await newOrder(coach, client, spec, { method: "MANUAL", manualKind: kind, createdBy: "COACH", status: "PENDING", expiresAt: null });
  if (note) {
    const d = await db();
    await d.update(paymentOrders).set({ noteEnc: encryptJson({ note }, aadNote(row.id)) }).where(eq(paymentOrders.id, row.id));
  }
  const r = await markPaid(row.id, { method: "MANUAL", manualKind: kind });
  return toOrder(r.order ?? row, await namesFor([client.id]), true);
}

/** The coach confirms a PayNow payment arrived (after the payer said they sent it, or just because they saw it). */
export async function confirmReceived(coach: UserRow, orderId: string): Promise<OrderRec> {
  requireCoach(coach);
  const d = await db();
  const [row] = await d.select().from(paymentOrders).where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.coachId, coach.id))).limit(1);
  if (!row) throw notFound("That payment wasn't found.");
  if (row.method === "STRIPE" && row.stripeSessionId) throw badRequest("That one is paid by card through Stripe and confirms itself.");
  const r = await markPaid(row.id, { method: row.method === "MANUAL" ? "MANUAL" : "PAYNOW" });
  return toOrder(r.order ?? row, await namesFor([row.clientId]), true);
}

export async function cancelOrder(coach: UserRow, orderId: string): Promise<void> {
  requireCoach(coach);
  const d = await db();
  const [u] = await d.update(paymentOrders).set({ status: "CANCELLED" }).where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.coachId, coach.id), inArray(paymentOrders.status, ["PENDING", "AWAITING"]))).returning({ id: paymentOrders.id });
  if (!u) throw notFound("That payment can't be cancelled.");
}

/* ---------------- Refunds ---------------- */
/** Marks an order REFUNDED and takes the credits back (never more than the client has left). Safe to call twice. */
export async function markRefunded(orderId: string): Promise<{ changed: boolean; order: PaymentOrderRow | null }> {
  const d = await db();
  const [claimed] = await d.update(paymentOrders).set({ status: "REFUNDED", refundedAt: new Date() }).where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.status, "PAID"))).returning();
  if (!claimed) {
    const [cur] = await d.select().from(paymentOrders).where(eq(paymentOrders.id, orderId)).limit(1);
    return { changed: false, order: cur ?? null };
  }
  const [clientRow] = await d.select().from(users).where(eq(users.id, claimed.clientId)).limit(1);
  if (clientRow && clientRow.role === "CLIENT") {
    if (claimed.appliedSessions > 0) {
      const have = openProfile(clientRow).credits;
      const take = Math.min(claimed.appliedSessions, have);
      if (take > 0) {
        const after = await adjustCredits(clientRow, -take);
        await logCredit({ clientId: clientRow.id, coachId: claimed.coachId, pool: "SESSION", kind: "ADJUSTMENT", delta: -take, sessionType: "1-on-1 PT", label: `Refunded: ${claimed.name}`, note: take < claimed.appliedSessions ? `${claimed.appliedSessions - take} already used` : undefined, balance: after });
      }
    }
    if (claimed.appliedGroup > 0) {
      const fresh = (await d.select().from(users).where(eq(users.id, clientRow.id)).limit(1))[0] ?? clientRow;
      const have = openProfile(fresh).groupClassCredits ?? 0;
      const take = Math.min(claimed.appliedGroup, have);
      if (take > 0) {
        const after = await adjustGroupCredits(fresh, -take);
        await logCredit({ clientId: clientRow.id, coachId: claimed.coachId, pool: "GROUP", kind: "ADJUSTMENT", delta: -take, sessionType: "Group class", label: `Refunded: ${claimed.name}`, balance: after });
      }
    }
    await notify([claimed.clientId], "payment_refunded", { title: "A payment was refunded", body: `Your ${sgd(claimed.amountCents)} payment for ${claimed.name} was refunded.`, link: "/pay" }, { email: false });
  }
  return { changed: true, order: claimed };
}

/** The coach refunds a payment in full. Card payments are refunded through Stripe (from the coach's account); others just take the credits back. */
export async function refundOrder(coach: UserRow, orderId: string): Promise<OrderRec> {
  requireCoach(coach);
  const d = await db();
  const [row] = await d.select().from(paymentOrders).where(and(eq(paymentOrders.id, orderId), eq(paymentOrders.coachId, coach.id))).limit(1);
  if (!row) throw notFound("That payment wasn't found.");
  if (row.status !== "PAID") throw badRequest("Only a payment that was received can be refunded.");
  if (row.method === "STRIPE" && row.paymentIntentId) {
    const st = await settingsOf(coach.id);
    if (!st?.stripeAccountId) throw badRequest("Your Stripe account isn't connected, so the card refund can't be made here. Refund it in your Stripe dashboard.");
    await stripe().refunds.create({ payment_intent: row.paymentIntentId }, { stripeAccount: st.stripeAccountId, idempotencyKey: `refund_${row.id}` });
  }
  const r = await markRefunded(row.id);
  return toOrder(r.order ?? row, await namesFor([row.clientId]), true);
}

/* ---------------- Lists ---------------- */
export interface Totals {
  paidCents: number;
  refundedCents: number;
  monthCents: number;
  count: number;
  awaiting: number;
}

export async function listForCoach(coach: UserRow, opts: { clientId?: string; limit?: number } = {}): Promise<{ orders: OrderRec[]; totals: Totals }> {
  requireCoach(coach);
  const d = await db();
  const where = opts.clientId ? and(eq(paymentOrders.coachId, coach.id), eq(paymentOrders.clientId, opts.clientId)) : eq(paymentOrders.coachId, coach.id);
  const rows = await d.select().from(paymentOrders).where(where).orderBy(desc(paymentOrders.createdAt)).limit(opts.limit ?? 200);
  const names = await namesFor(rows.map((r) => r.clientId));
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const totals: Totals = { paidCents: 0, refundedCents: 0, monthCents: 0, count: 0, awaiting: 0 };
  for (const r of rows) {
    if (r.status === "PAID") {
      totals.paidCents += r.amountCents;
      totals.count++;
      if (r.paidAt && r.paidAt >= monthStart) totals.monthCents += r.amountCents;
    } else if (r.status === "REFUNDED") totals.refundedCents += r.amountCents;
    else if (r.status === "AWAITING") totals.awaiting++;
  }
  return { orders: rows.map((r) => toOrder(r, names, true)), totals };
}

export async function listForClient(client: UserRow): Promise<OrderRec[]> {
  if (client.role !== "CLIENT") throw forbidden();
  const d = await db();
  const rows = await d.select().from(paymentOrders).where(and(eq(paymentOrders.clientId, client.id), inArray(paymentOrders.status, ["PAID", "REFUNDED", "AWAITING", "PENDING"]))).orderBy(desc(paymentOrders.createdAt)).limit(100);
  const names = await namesFor([client.id]);
  return rows.filter((r) => r.status !== "PENDING" || r.createdBy === "COACH").map((r) => toOrder(r, names, false));
}

/** A CSV the coach can open in a spreadsheet or hand to an accountant. */
export async function exportCsv(coach: UserRow): Promise<string> {
  const { orders } = await listForCoach(coach, { limit: 5000 });
  const q = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Date", "Client", "Package", "Sessions", "Group credits", "Amount (SGD)", "How paid", "Status", "Reference", "Receipt"];
  const lines = orders.map((o) => [o.paidAt ?? o.createdAt, o.clientName, o.name, o.sessions, o.groupCredits, (o.amountCents / 100).toFixed(2), o.method === "STRIPE" ? "Stripe" : o.method === "PAYNOW" ? "PayNow" : (o.manualKind ?? "Recorded"), o.status, o.ref, o.receiptUrl ?? ""].map(q).join(","));
  return [head.map(q).join(","), ...lines].join("\r\n");
}

/* ---------------- Stripe webhooks (Connect) ---------------- */
async function ordersCoachMatches(order: PaymentOrderRow, accountId: string | undefined): Promise<boolean> {
  const st = await settingsOf(order.coachId);
  return !!st?.stripeAccountId && st.stripeAccountId === accountId;
}

/**
 * Handles one event from Stripe (already checked against the signing secret). Only what the server already knows is trusted: the order
 * comes from our own id, and the amount, currency and the coach's own account must match before any credit is added.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<{ handled: boolean; note?: string }> {
  const d = await db();
  const inserted = await d.insert(paymentEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning({ id: paymentEvents.id });
  if (!inserted.length) return { handled: false, note: "duplicate" };
  try {
    if (event.type === "account.updated") {
      const a = event.data.object as Stripe.Account;
      const [st] = await d.select().from(paymentSettings).where(eq(paymentSettings.stripeAccountId, a.id)).limit(1);
      if (st) await d.update(paymentSettings).set({ chargesEnabled: !!a.charges_enabled, detailsSubmitted: !!a.details_submitted, payoutsEnabled: !!a.payouts_enabled, updatedAt: new Date() }).where(eq(paymentSettings.coachId, st.coachId));
      return { handled: true };
    }
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data.object as Stripe.Checkout.Session;
      const orderId = s.metadata?.order_id ?? s.client_reference_id ?? "";
      const [order] = await d.select().from(paymentOrders).where(eq(paymentOrders.id, orderId)).limit(1);
      if (!order) return { handled: false, note: "unknown order" };
      if (!(await ordersCoachMatches(order, event.account))) return { handled: false, note: "wrong account" };
      if (s.currency !== order.currency || s.amount_total !== order.amountCents) return { handled: false, note: "amount mismatch" };
      if (s.payment_status !== "paid") return { handled: true, note: "not paid yet" }; // PayNow can take a moment: async_payment_succeeded follows
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);
      let receiptUrl: string | null = null;
      if (pi) {
        try {
          const p = await stripe().paymentIntents.retrieve(pi, { expand: ["latest_charge"] }, { stripeAccount: event.account });
          const ch = p.latest_charge;
          receiptUrl = ch && typeof ch !== "string" ? (ch.receipt_url ?? null) : null;
        } catch {
          receiptUrl = null; // the receipt is a nicety; the payment still counts
        }
      }
      await markPaid(order.id, { method: "STRIPE", paymentIntentId: pi, receiptUrl });
      return { handled: true };
    }
    if (event.type === "charge.refunded") {
      const c = event.data.object as Stripe.Charge;
      const pi = typeof c.payment_intent === "string" ? c.payment_intent : (c.payment_intent?.id ?? null);
      if (!pi || !c.refunded) return { handled: true, note: "partial refund ignored" }; // only full refunds change credits
      const [order] = await d.select().from(paymentOrders).where(eq(paymentOrders.paymentIntentId, pi)).limit(1);
      if (!order || !(await ordersCoachMatches(order, event.account))) return { handled: false, note: "unknown charge" };
      await markRefunded(order.id);
      return { handled: true };
    }
    return { handled: true, note: "ignored" };
  } catch (e) {
    // Let Stripe retry: forget that we saw it.
    await d.delete(paymentEvents).where(eq(paymentEvents.id, event.id));
    throw e;
  }
}
