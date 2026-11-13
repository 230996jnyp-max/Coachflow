/*
 * Payments between a coach and their clients: the shared rules (money, packages, statuses, a fee estimate). Pure: no imports, so it runs
 * in the browser and on the server. The platform takes nothing from a payment (an application fee of 0): the client pays the coach.
 */

export const CURRENCY = "sgd";

/** Whole cents to "S$1,234.50". */
export function sgd(cents: number): string {
  const v = Math.round(cents) / 100;
  return `S$${v.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The most one payment can be (Stripe's own limit for a Singapore account is far higher; this keeps a typo from becoming a real charge). */
export const MAX_PRICE_CENTS = 500_000; // S$5,000
export const MIN_PRICE_CENTS = 100; // S$1

export interface PackageInput {
  name: string;
  sessions: number;
  groupCredits: number;
  /** Price in dollars as typed (for example 450 or 450.50). */
  price: number;
}

export type CleanPackage = { ok: true; name: string; sessions: number; groupCredits: number; priceCents: number } | { ok: false; error: string };

/** Checks a package a coach typed. Credits are whole numbers; a package must give at least one credit. */
export function cleanPackage(raw: unknown): CleanPackage {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (name.length < 2) return { ok: false, error: "Give the package a name, like “10 sessions”." };
  const sessions = Number(r.sessions ?? 0);
  const groupCredits = Number(r.groupCredits ?? 0);
  if (!Number.isInteger(sessions) || sessions < 0 || sessions > 500) return { ok: false, error: "Sessions must be a whole number from 0 to 500." };
  if (!Number.isInteger(groupCredits) || groupCredits < 0 || groupCredits > 500) return { ok: false, error: "Group class credits must be a whole number from 0 to 500." };
  if (sessions + groupCredits < 1) return { ok: false, error: "A package needs at least one session or group class credit." };
  const price = Number(r.price);
  if (!Number.isFinite(price)) return { ok: false, error: "Enter a price." };
  const priceCents = Math.round(price * 100);
  if (priceCents < MIN_PRICE_CENTS) return { ok: false, error: "The price must be at least S$1." };
  if (priceCents > MAX_PRICE_CENTS) return { ok: false, error: `The price can be at most ${sgd(MAX_PRICE_CENTS)}.` };
  return { ok: true, name, sessions, groupCredits, priceCents };
}

export const ORDER_STATUS = ["PENDING", "AWAITING", "PAID", "REFUNDED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];
export type OrderMethod = "STRIPE" | "PAYNOW" | "MANUAL";
export const MANUAL_KINDS = ["Cash", "PayNow", "Bank transfer", "Other"] as const;

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Waiting for payment",
  AWAITING: "Says paid, needs your OK",
  PAID: "Paid",
  REFUNDED: "Refunded",
  CANCELLED: "Cancelled",
};

/**
 * A rough estimate of what Stripe takes from the coach on a payment in Singapore (the platform takes nothing). Cards: 3.4% + S$0.50;
 * PayNow through Stripe: 1.3%. Only an estimate for the coach's information: Stripe's own figure is the real one.
 */
export function estimateStripeFeeCents(amountCents: number, via: "card" | "paynow" = "card"): number {
  return via === "paynow" ? Math.round(amountCents * 0.013) : Math.round(amountCents * 0.034) + 50;
}

/** A PayNow number (a Singapore mobile: 8 digits starting with 8 or 9, with or without +65) or a company UEN (9 or 10 characters). */
export function cleanPayNow(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const s = typeof raw === "string" ? raw.trim() : "";
  const digits = s.replace(/[\s-]/g, "").replace(/^\+?65/, "");
  if (/^[89]\d{7}$/.test(digits)) return { ok: true, value: digits };
  const uen = s.replace(/\s/g, "").toUpperCase();
  if (/^[0-9]{8,9}[A-Z]$/.test(uen) || /^(T|S)\d{2}[A-Z]{2}\d{4}[A-Z]$/.test(uen)) return { ok: true, value: uen };
  return { ok: false, error: "Enter a Singapore mobile number (8 digits starting with 8 or 9) or a company UEN." };
}

/** What a payer is shown for the PayNow option: where to send, how much, and the reference to type so the coach can match it. */
export const payNowLine = (paynow: string, amountCents: number, ref: string) => `PayNow ${paynow}, ${sgd(amountCents)}, reference ${ref}`;

/** A short reference like "CF-7K3QD2" taken from an order's random id (no look-alike letters). */
export function refFrom(seed: string): string {
  const A = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += A[Math.abs(h) % A.length];
    h = Math.imul(h ^ (h >>> 13), 2246822519) + 7;
  }
  return `CF-${out}`;
}
