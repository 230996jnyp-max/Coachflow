"use client";

import { format, parseISO } from "date-fns";
import { CreditCard, ExternalLink, Infinity as InfinityIcon } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { sgd, TIERS, type BillingStatus } from "@/lib/billing";
import { openStripe, useBilling } from "@/lib/billingState";
import { IOS_PLAN_NOTE, useIosApp } from "@/lib/nativeApp";

const LABEL: Record<BillingStatus, { text: string; cls: string }> = {
  LIFETIME_FREE: { text: "Lifetime free", cls: "border-success/30 bg-success/15 text-success" },
  TRIALING: { text: "Free trial", cls: "border-accent/30 bg-accent/15 text-accent" },
  ACTIVE: { text: "Active", cls: "border-success/30 bg-success/15 text-success" },
  PAST_DUE: { text: "Payment failed", cls: "border-danger/30 bg-danger/15 text-danger" },
  CANCELED: { text: "Cancelled", cls: "border-danger/30 bg-danger/15 text-danger" },
  EXPIRED: { text: "Trial ended", cls: "border-danger/30 bg-danger/15 text-danger" },
};

/** Settings > Subscription & billing: plan, price for today's roster, renewal, and the Stripe buttons. Coach only. */
export function BillingCard() {
  const b = useBilling();
  const ios = useIosApp();
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTiers, setShowTiers] = useState(false);
  if (!b || b.role !== "COACH") return null;
  if (ios) return <Notice tone="info">{IOS_PLAN_NOTE}</Notice>;
  const label = LABEL[b.status];
  const gst = b.gst ? " + GST" : "";

  const go = async (kind: "checkout" | "portal") => {
    setBusy(kind);
    setError(null);
    const err = await openStripe(kind);
    if (err) {
      setError(err);
      setBusy(null);
    }
  };

  if (b.exempt) {
    return (
      <Card className="flex items-center gap-3 p-5">
        <InfinityIcon size={22} className="shrink-0 text-success" />
        <div>
          <div className="flex items-center gap-2 font-semibold">
            Subscription <Badge className={label.cls}>{label.text}</Badge>
          </div>
          <p className="text-sm text-muted">{b.gym ? "Your gym covers your CoachFlow account, so there is nothing to pay here." : "Your account has free lifetime access. You will never be asked to pay."}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Subscription</div>
        <Badge className={label.cls}>{label.text}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-field p-3">
          <dt className="text-xs text-muted">Active clients</dt>
          <dd className="text-lg font-bold">{b.activeClients}</dd>
        </div>
        <div className="rounded-xl bg-field p-3">
          <dt className="text-xs text-muted">Your plan</dt>
          <dd className="text-lg font-bold">
            {sgd(b.tierCents)}
            <span className="text-xs font-medium text-muted">/mo{gst}</span>
          </dd>
        </div>
        {b.status === "TRIALING" && !b.hasSubscription && (
          <div className="col-span-2 rounded-xl bg-accent/10 p-3">
            <dt className="text-xs text-muted">Free trial</dt>
            <dd className="font-semibold text-accent">
              {b.trialDaysLeft} day{b.trialDaysLeft === 1 ? "" : "s"} remaining{b.trialEnds ? ` (ends ${format(parseISO(b.trialEnds), "d MMM yyyy")})` : ""}
            </dd>
          </div>
        )}
        {b.hasSubscription && b.renewsOn && (
          <div className="col-span-2 rounded-xl bg-field p-3">
            <dt className="text-xs text-muted">{b.cancelAtPeriodEnd ? "Access ends" : "Next renewal"}</dt>
            <dd className="font-semibold">{format(parseISO(b.renewsOn), "d MMM yyyy")}</dd>
          </div>
        )}
      </dl>

      {b.status === "PAST_DUE" && <Notice tone="error">Your last payment didn&apos;t go through. Open Manage Subscription &amp; Billing to update your card.</Notice>}
      {b.hasSubscription && !b.cancelAtPeriodEnd && <p className="text-xs text-muted">The price follows your active clients (archived ones don&apos;t count) and only changes on your next renewal date, never mid-month.</p>}
      {b.cancelAtPeriodEnd && <Notice tone="warn">Your subscription is set to end on the date above. You can undo that in Manage Subscription &amp; Billing.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap gap-2">
        {!b.hasSubscription ? (
          <Button onClick={() => void go("checkout")} disabled={busy !== null || !b.stripeReady}>
            <CreditCard size={16} /> {busy === "checkout" ? "Opening Stripe…" : "Subscribe with Stripe"}
          </Button>
        ) : (
          <Button onClick={() => void go("portal")} disabled={busy !== null}>
            <ExternalLink size={16} /> {busy === "portal" ? "Opening…" : "Manage Subscription & Billing"}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setShowTiers((v) => !v)}>
          {showTiers ? "Hide pricing" : "How pricing works"}
        </Button>
      </div>
      {!b.stripeReady && !b.hasSubscription && <p className="text-xs text-muted">Online payments aren&apos;t switched on yet.</p>}

      {showTiers && (
        <div className="rounded-xl border border-line p-3 text-sm">
          <div className="mb-2 text-xs text-muted">Monthly price by number of active clients{gst ? " (GST added at checkout)" : ""}. Every new coach starts with 30 days free.</div>
          <ul className="space-y-1">
            {TIERS.map((t, i) => {
              const from = i === 0 ? 1 : TIERS[i - 1].upTo + 1;
              return (
                <li key={t.cents} className="flex justify-between gap-3">
                  <span className="text-muted">{t.upTo === Infinity ? `${from}+ clients (unlimited)` : `${from}–${t.upTo} clients`}</span>
                  <span className="font-semibold">{sgd(t.cents)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
