"use client";

import { AlertTriangle, CheckCircle2, Clock, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { dismissBillingNotice, useBillingNotice } from "@/lib/billingNotice";
import { openStripe, useBilling } from "@/lib/billingState";

/**
 * A thin strip at the top of a coach's screen: the free-trial countdown, a payment-failed warning with a button to fix it, and the
 * "you're subscribed" confirmation after Stripe Checkout. Also the toast that says what the roster will cost after a client is added.
 */
export function BillingBar() {
  const b = useBilling();
  const path = usePathname();
  const notice = useBillingNotice();
  const [hideSuccess, setHideSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const justSubscribed = !hideSuccess && path === "/trainer" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("billing") === "success";

  return (
    <>
      {b && b.role === "COACH" && !b.exempt && (
        <div className="mb-4 space-y-2">
          {justSubscribed && (
            <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm font-semibold text-success">
              <span className="flex items-center gap-2">
                <CheckCircle2 size={18} /> You&apos;re subscribed. Thank you! Your billing details are in Settings.
              </span>
              <button type="button" aria-label="Dismiss" onClick={() => setHideSuccess(true)} className="shrink-0">
                <X size={16} />
              </button>
            </div>
          )}
          {b.status === "TRIALING" && !b.hasSubscription && b.trialDaysLeft > 0 && (
            <Link href="/settings" className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 text-xs font-bold text-accent">
              <Clock size={14} /> Free Trial: {b.trialDaysLeft} day{b.trialDaysLeft === 1 ? "" : "s"} remaining
            </Link>
          )}
          {b.status === "PAST_DUE" && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
              <span className="flex items-center gap-2 font-semibold text-danger">
                <AlertTriangle size={18} /> Your last payment didn&apos;t go through. Update your card to keep your subscription.
              </span>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  if (await openStripe("portal")) setBusy(false);
                }}
              >
                Fix payment
              </Button>
            </div>
          )}
        </div>
      )}
      {notice && (
        <div role="status" className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-2xl border border-accent/40 bg-surface px-4 py-3 text-sm shadow-2xl md:bottom-6">
          <div className="flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss" onClick={dismissBillingNotice} className="shrink-0 text-muted hover:text-ink">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
