import type { OrderMethod, OrderStatus } from "@/lib/payments";

/** What the payments endpoints send back (the same shapes as the server builds, kept here so screens need no server code). */

export interface PaymentStateRec {
  serverReady: boolean;
  connected: boolean;
  stripeReady: boolean;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  paynow: string | null;
}

export interface PackageRec {
  id: string;
  name: string;
  sessions: number;
  groupCredits: number;
  priceCents: number;
  active: boolean;
}

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

export interface TotalsRec {
  paidCents: number;
  refundedCents: number;
  monthCents: number;
  count: number;
  awaiting: number;
}

export interface BuyOptionsRec {
  coachName: string;
  packages: PackageRec[];
  stripeReady: boolean;
  paynow: string | null;
  minor: boolean;
}

export interface PublicOrderRec {
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

/** "10 sessions + 2 group classes" for a package or an order. */
export function creditsText(sessions: number, groupCredits: number): string {
  const bits: string[] = [];
  if (sessions) bits.push(`${sessions} session${sessions === 1 ? "" : "s"}`);
  if (groupCredits) bits.push(`${groupCredits} group class${groupCredits === 1 ? "" : "es"}`);
  return bits.join(" + ");
}
