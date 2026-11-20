/*
 * Coach subscriptions (Singapore dollars). The price follows the number of ACTIVE clients (archived or deactivated ones don't count):
 * $15 a month up to 5 clients, then +$3 for every further 5, to $36 at 36-40 clients, and a flat $40 for 41 or more.
 * Pure functions, shared by the app, the server and the Stripe setup script.
 */

export const TRIAL_DAYS = 30;
export const CURRENCY = "sgd";

/** Upper client count of each tier and its monthly price in cents. The last tier is open ended. */
export const TIERS: { upTo: number; cents: number }[] = [
  { upTo: 5, cents: 1500 },
  { upTo: 10, cents: 1800 },
  { upTo: 15, cents: 2100 },
  { upTo: 20, cents: 2400 },
  { upTo: 25, cents: 2700 },
  { upTo: 30, cents: 3000 },
  { upTo: 35, cents: 3300 },
  { upTo: 40, cents: 3600 },
  { upTo: Infinity, cents: 4000 },
];

/** Every monthly price there is (one Stripe price each). */
export const TIER_CENTS = TIERS.map((t) => t.cents);

/** The monthly price in cents for this many active clients (nobody pays less than the first tier). */
export function tierFor(activeClients: number): number {
  const n = Math.max(0, Math.floor(activeClients));
  return TIERS.find((t) => n <= t.upTo)!.cents;
}

/** "$15 SGD" */
export const sgd = (cents: number): string => `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)} SGD`;

/** The key Stripe uses to find a tier's price again without storing ids ("coachflow_sgd_18"). */
export const lookupKey = (cents: number): string => `coachflow_sgd_${cents / 100}`;

export type BillingStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED" | "LIFETIME_FREE";

export interface BillingFields {
  exempt: boolean;
  status: string;
  trialEnd: Date | null;
  periodEnd: Date | null;
  hasSubscription: boolean;
}

/** What a coach's billing really is right now (a trial that has run out is EXPIRED even if nothing has updated the row). */
export function effectiveStatus(b: BillingFields, now = new Date()): BillingStatus {
  if (b.exempt) return "LIFETIME_FREE";
  const s = b.status as BillingStatus;
  if (s === "TRIALING" && b.trialEnd && b.trialEnd.getTime() <= now.getTime()) return b.hasSubscription ? "ACTIVE" : "EXPIRED";
  // A cancelled subscription keeps working until the period that was paid for ends.
  if (s === "CANCELED" && b.periodEnd && b.periodEnd.getTime() > now.getTime()) return "ACTIVE";
  return s;
}

/** Without a working subscription or trial, the coach and their clients are paused (nothing is ever deleted). */
export const isBlockedStatus = (s: BillingStatus): boolean => s === "EXPIRED" || s === "CANCELED";

/** Whole days left in a trial (rounded up, never negative). */
export function trialDaysLeft(trialEnd: Date | null, now = new Date()): number {
  if (!trialEnd) return 0;
  return Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000));
}

export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

/** What the app shows the signed-in person about billing. */
export interface BillingInfo {
  /** Is the subscription requirement switched on for this deployment? */
  enforced: boolean;
  role: "COACH" | "CLIENT";
  /** Coach: no billing at all (the owner, and coaches the owner added as testers). */
  exempt: boolean;
  /** Coach: covered by their gym (gym plans come later), so there is nothing to pay here. */
  gym?: boolean;
  status: BillingStatus;
  /** Coach or client: the coach (and so the client) is paused. Only ever true when `enforced`. */
  blocked: boolean;
  trialDaysLeft: number;
  trialEnds: string | null;
  activeClients: number;
  /** The monthly price for today's active clients, in cents (before GST). */
  tierCents: number;
  /** What is actually being charged right now, in cents (0 during a trial). */
  renewsOn: string | null;
  hasSubscription: boolean;
  cancelAtPeriodEnd: boolean;
  /** GST is added at checkout. */
  gst: boolean;
  /** Stripe isn't set up on this deployment (so Subscribe can't work yet). */
  stripeReady: boolean;
  /** For a client: their coach's first name. */
  coachName?: string;
  /** For a coach in a gym: the gym's plan (the gym pays, so the coach pays nothing). Paused when the gym's plan has ended. */
  gymPlan?: GymPlanSummary;
}

/** A gym's plan as its owner and coaches see it. */
export interface GymPlanSummary {
  name: string;
  ownerName: string;
  isOwner: boolean;
  status: "FREE" | "TRIALING" | "ACTIVE" | "GRACE" | "EXPIRED" | "LAPSED";
  blocked: boolean;
  graceDaysLeft: number | null;
  trialDaysLeft: number | null;
  priceCents: number;
  needsCustomPlan: boolean;
  coaches: number;
  smallMax: number;
  planRequested: boolean;
}
