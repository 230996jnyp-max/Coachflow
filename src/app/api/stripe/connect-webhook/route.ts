import { NextResponse } from "next/server";
import { handleStripeEvent, stripe } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — Stripe tells us a payment happened on a coach's own account (a "Connect" webhook; its signing secret is
 * STRIPE_CONNECT_WEBHOOK_SECRET). The signature is checked on the raw body first; anything unsigned is refused. Credits are only
 * ever added by a verified event, once.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) return NextResponse.json({ error: "Not allowed." }, { status: 400 });
  const raw = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }
  try {
    const r = await handleStripeEvent(event);
    return NextResponse.json({ received: true, ...r });
  } catch (e) {
    console.error("stripe connect webhook failed", event.type, e instanceof Error ? e.message : "");
    return NextResponse.json({ error: "Try again." }, { status: 500 }); // Stripe retries
  }
}
