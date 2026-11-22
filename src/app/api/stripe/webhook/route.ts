import { NextResponse } from "next/server";
import Stripe from "stripe";
import { handleStripeEvent } from "@/lib/server/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — Stripe tells us about subscription changes. The signature is checked with STRIPE_WEBHOOK_SECRET before anything is read:
 * anything unsigned or altered is refused. Handled: checkout completed, subscription created / updated / deleted, payment failed,
 * and the upcoming-invoice notice (when the price is re-checked against the roster).
 */
export async function POST(req: Request) {
  // The name in the docs is STRIPE_WEBHOOK_SECRET; the longer spelling is accepted too, because that is how it was first saved in Vercel.
  const secret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET_KEY;
  const signature = req.headers.get("stripe-signature");
  if (!secret) return NextResponse.json({ error: "Webhook isn't configured." }, { status: 503 });
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  const body = await req.text(); // the exact bytes Stripe signed
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  try {
    const handled = await handleStripeEvent(event);
    return NextResponse.json({ received: true, handled });
  } catch (e) {
    console.error("Stripe webhook failed", event.type, e instanceof Error ? e.message : "");
    // A 500 makes Stripe retry later.
    return NextResponse.json({ error: "Could not process the event." }, { status: 500 });
  }
}
