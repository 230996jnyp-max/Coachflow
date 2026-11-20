/*
 * Gym subscriptions (Singapore dollars): the pure rules, shared by the server, the gym portal, the owner's Admin and the tests.
 *  - A small boutique gym pays one flat price a month, whatever its coaches' client numbers. It covers every coach in the gym (they never pay
 *    their own subscription) and the gym's admins.
 *  - A gym with more than GYM_SMALL_MAX_COACHES active coaches emails the owner for a custom price, which the owner sets in Admin.
 *  - A new gym has a free month (TRIAL_DAYS). When a payment fails there is a grace period; after it the gym is paused (nothing is deleted).
 */

export const GYM_PRICE_CENTS = 10_000;
/** Up to this many active coaches a gym can subscribe by itself at the flat price. */
export const GYM_SMALL_MAX_COACHES = 10;
/** Days a gym keeps working after a failed payment before it is paused. */
export const GYM_GRACE_DAYS = 7;

/** The key Stripe uses to find the standard gym price again ("coachflow_gym_sgd_100"). */
export const gymLookupKey = (cents: number): string => `coachflow_gym_sgd_${cents / 100}`;

export type GymPlanStatus = "FREE" | "TRIALING" | "ACTIVE" | "GRACE" | "EXPIRED" | "LAPSED";

export interface GymBillingFields {
  /** The gym has no trial date and no subscription: the platform owner made it free (a tester). */
  free: boolean;
  trialEnd: Date | null;
  hasSubscription: boolean;
  /** TRIALING | ACTIVE | PAST_DUE | CANCELED, as kept from Stripe. */
  status: string;
  periodEnd: Date | null;
  pastDueSince: Date | null;
}

export interface GymPlanState {
  status: GymPlanStatus;
  /** Paused: the portal and the gym's coaches stop until the gym subscribes or pays. */
  blocked: boolean;
  /** Days left to fix a failed payment (only while status is GRACE). */
  graceDaysLeft: number | null;
}

const DAY = 86_400_000;

/** What a gym's billing really is right now, from the fields we keep. */
export function gymPlanState(b: GymBillingFields, now = new Date()): GymPlanState {
  if (b.free && !b.hasSubscription) return { status: "FREE", blocked: false, graceDaysLeft: null };
  if (b.hasSubscription) {
    if (b.status === "PAST_DUE") {
      const since = b.pastDueSince ?? now;
      const left = GYM_GRACE_DAYS - Math.floor((now.getTime() - since.getTime()) / DAY);
      return left > 0 ? { status: "GRACE", blocked: false, graceDaysLeft: left } : { status: "LAPSED", blocked: true, graceDaysLeft: 0 };
    }
    // A cancelled subscription keeps working until the period that was paid for ends.
    if (b.status === "CANCELED") return b.periodEnd && b.periodEnd.getTime() > now.getTime() ? { status: "ACTIVE", blocked: false, graceDaysLeft: null } : { status: "LAPSED", blocked: true, graceDaysLeft: null };
    return { status: "ACTIVE", blocked: false, graceDaysLeft: null };
  }
  if (b.trialEnd && b.trialEnd.getTime() > now.getTime()) return { status: "TRIALING", blocked: false, graceDaysLeft: null };
  return { status: "EXPIRED", blocked: true, graceDaysLeft: null };
}

/** What the gym pays each month: the owner's custom price when there is one, otherwise the flat price. */
export const gymMonthlyCents = (customCents: number | null | undefined): number => (customCents && customCents > 0 ? customCents : GYM_PRICE_CENTS);

/** A big gym with no custom price yet can't subscribe by itself: it asks the platform owner for one. */
export const needsCustomPlan = (activeCoaches: number, customCents: number | null | undefined): boolean => !(customCents && customCents > 0) && activeCoaches > GYM_SMALL_MAX_COACHES;

/** A custom price the owner types in dollars, as cents (S$1 to S$10,000), or null for none. Throws a plain message when it is not a sensible amount. */
export function parseCustomPrice(dollars: unknown): number | null {
  if (dollars === null || dollars === undefined || dollars === "") return null;
  const n = typeof dollars === "number" ? dollars : Number(dollars);
  if (!Number.isFinite(n) || n < 1 || n > 10_000) throw new Error("A price is between S$1 and S$10,000 a month.");
  return Math.round(n * 100);
}

/** Days from now to a date, rounded up (0 once it has passed). */
export const daysLeft = (end: Date | null, now = new Date()): number | null => (end ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY)) : null);

export const planLabel: Record<GymPlanStatus, string> = {
  FREE: "Free (set by CoachFlow)",
  TRIALING: "Free trial",
  ACTIVE: "Subscribed",
  GRACE: "Payment failed",
  EXPIRED: "Trial ended",
  LAPSED: "Paused",
};
