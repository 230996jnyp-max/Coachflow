"use client";

import { CreditCard, LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { sgd, type BillingInfo } from "@/lib/billing";
import { openStripe } from "@/lib/billingState";
import { logout } from "@/lib/store";

/**
 * Shown instead of the app when a coach has no trial or subscription (and to that coach's clients). Nothing is deleted: the coach's
 * clients and workout history are kept, and everything comes back as soon as the subscription is renewed.
 */
export function BillingGate({ info }: { info: BillingInfo }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coach = info.role === "COACH";
  const price = `${sgd(info.tierCents)}/mo${info.gst ? " + GST" : ""}`;
  const neverSubscribed = !info.hasSubscription && info.trialEnds !== null;

  const subscribe = async () => {
    setBusy(true);
    setError(null);
    const err = await openStripe("checkout");
    if (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="pt-safe pb-safe animate-fade-in flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <Card className="w-full max-w-md space-y-5 p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">{coach ? <CreditCard size={28} /> : <ShieldCheck size={28} />}</div>
        {coach ? (
          <>
            <h1 className="text-xl font-bold">Subscription Required</h1>
            <p className="text-sm text-muted">
              {neverSubscribed ? "Your 30-day free trial has concluded. " : "Your CoachFlow subscription has ended. "}
              Subscribe to CoachFlow for <strong className="text-ink">{price}</strong> to continue coaching your {info.activeClients} active client{info.activeClients === 1 ? "" : "s"}.
            </p>
            <Notice tone="info">Your clients and workout history are safe and untouched. Everything is right where you left it.</Notice>
            {error && <Notice tone="error">{error}</Notice>}
            <Button size="lg" className="w-full" onClick={() => void subscribe()} disabled={busy || !info.stripeReady}>
              <CreditCard size={18} /> {busy ? "Opening Stripe…" : "Subscribe with Stripe"}
            </Button>
            {!info.stripeReady && <p className="text-xs text-muted">Online payments aren&apos;t switched on yet. Please contact support.</p>}
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">Coaching is paused</h1>
            <p className="text-sm text-muted">
              {info.coachName ? `${info.coachName}'s` : "Your coach's"} CoachFlow subscription has lapsed, so the app is paused for now. Your workouts and progress are safe. Please contact {info.coachName ?? "your coach"} to continue.
            </p>
          </>
        )}
        <button
          type="button"
          onClick={async () => {
            await logout();
            window.location.assign("/login");
          }}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
        >
          <LogOut size={15} /> Sign out
        </button>
      </Card>
    </div>
  );
}
