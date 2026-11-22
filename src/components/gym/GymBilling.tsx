"use client";

import { format, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, CreditCard, Mail } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Notice, Textarea } from "@/components/ui";
import { sgd } from "@/lib/billing";
import { planLabel } from "@/lib/gymBilling";
import { openGymStripe } from "@/lib/billingState";
import { api } from "@/lib/store";

interface PlanView {
  gymName: string;
  status: "FREE" | "TRIALING" | "ACTIVE" | "GRACE" | "EXPIRED" | "LAPSED";
  blocked: boolean;
  graceDaysLeft: number | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  hasSubscription: boolean;
  renewsOn: string | null;
  cancelAtPeriodEnd: boolean;
  priceCents: number;
  customPrice: boolean;
  coaches: number;
  smallMax: number;
  needsCustomPlan: boolean;
  planRequested: boolean;
  gst: boolean;
  stripeReady: boolean;
  enforced: boolean;
}

const TONE: Record<PlanView["status"], string> = {
  FREE: "border-success/30 bg-success/15 text-success",
  TRIALING: "border-accent/30 bg-accent/15 text-accent",
  ACTIVE: "border-success/30 bg-success/15 text-success",
  GRACE: "border-danger/30 bg-danger/15 text-danger",
  EXPIRED: "border-danger/30 bg-danger/15 text-danger",
  LAPSED: "border-danger/30 bg-danger/15 text-danger",
};

/** The gym owner's billing: the free month, the flat price, subscribing, the card, a failed payment, and asking for a custom price. */
export function GymBilling() {
  const [v, setV] = useState<PlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    const r = await api<PlanView>("/api/gym/billing");
    if (r.ok && r.data) {
      setV(r.data);
      setError(null);
    } else setError(r.error ?? "Could not load your gym's billing.");
  }, []);

  useEffect(() => {
    let alive = true;
    void api<PlanView>("/api/gym/billing").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setV(r.data);
      else setError(r.error ?? "Could not load your gym's billing.");
    });
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!v) return <p className="text-sm text-muted">Loading…</p>;

  const price = `${sgd(v.priceCents)}/month${v.gst ? " + GST" : ""}`;
  const go = async (kind: "checkout" | "portal") => {
    setBusy(kind);
    setError(null);
    const err = await openGymStripe(kind);
    if (err) {
      setError(err);
      setBusy(null);
    }
  };
  const ask = async () => {
    setBusy("ask");
    setError(null);
    const r = await api("/api/gym/billing", { body: { action: "request-plan", note } });
    setBusy(null);
    if (!r.ok) return setError(r.error ?? "Couldn't send that. Please try again.");
    setSent(true);
    void load();
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">Your gym&apos;s plan</h2>
          <Badge className={TONE[v.status]}>{planLabel[v.status]}</Badge>
        </div>

        {v.status === "FREE" && <p className="text-sm text-muted">{v.gymName} has free access set by CoachFlow, so there is nothing to pay.</p>}

        {v.status === "TRIALING" && (
          <p className="text-sm">
            Free month: <strong>{v.trialDaysLeft} day{v.trialDaysLeft === 1 ? "" : "s"} left</strong>
            {v.trialEndsAt ? ` (ends ${format(parseISO(v.trialEndsAt), "d MMM yyyy")})` : ""}. It covers you and every coach in your gym. If you subscribe now, the rest of the free month still counts: your first payment is when it ends.
          </p>
        )}

        {v.status === "ACTIVE" && (
          <p className="flex items-start gap-2 text-sm">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
            <span>
              Subscribed at <strong>{price}</strong>.{v.renewsOn ? ` ${v.cancelAtPeriodEnd ? "Ends" : "Renews"} on ${format(parseISO(v.renewsOn), "d MMM yyyy")}.` : ""}
              {v.cancelAtPeriodEnd ? " It won't renew: renew it in Manage billing to keep your gym running." : ""}
            </span>
          </p>
        )}

        {v.status === "GRACE" && (
          <Notice tone="error">
            <span className="flex items-center gap-2 font-semibold">
              <AlertTriangle size={16} /> The last payment didn&apos;t go through. Your gym is paused in {v.graceDaysLeft} day{v.graceDaysLeft === 1 ? "" : "s"} unless the card is updated.
            </span>
          </Notice>
        )}

        {(v.status === "EXPIRED" || v.status === "LAPSED") && (
          <Notice tone="error">
            {v.status === "EXPIRED" ? "Your free month has ended." : "Your subscription has lapsed."} The gym portal and your coaches are paused until the gym subscribes. Nothing is deleted: everything comes back as soon as you subscribe.
          </Notice>
        )}

        {v.status !== "FREE" && !v.needsCustomPlan && (
          <div className="rounded-xl border border-line bg-field/40 p-3 text-sm">
            <div className="font-semibold">{price}</div>
            <div className="text-xs text-muted">
              One flat price for your whole gym (up to {v.smallMax} coaches; you have {v.coaches}). Every coach in your gym is covered, whatever their number of clients, so coaches pay nothing themselves. A coach who already pays for their own CoachFlow stops being charged once the period they paid for ends.
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(v.status === "TRIALING" || v.status === "EXPIRED" || v.status === "LAPSED") && !v.needsCustomPlan && !v.hasSubscription && (
            <Button onClick={() => void go("checkout")} disabled={!!busy || !v.stripeReady}>
              <CreditCard size={16} /> {busy === "checkout" ? "Opening Stripe…" : `Subscribe, ${price}`}
            </Button>
          )}
          {v.hasSubscription && (
            <Button variant={v.status === "GRACE" ? "danger" : "secondary"} onClick={() => void go("portal")} disabled={!!busy}>
              <CreditCard size={16} /> {busy === "portal" ? "Opening Stripe…" : v.status === "GRACE" ? "Update card" : "Manage billing"}
            </Button>
          )}
        </div>
        {!v.stripeReady && v.status !== "FREE" && <p className="text-xs text-muted">Online payments aren&apos;t switched on yet. Please contact CoachFlow support.</p>}
        {!v.enforced && v.status !== "FREE" && <p className="text-xs text-muted">Payments are not required yet, so nothing is paused for now.</p>}
      </Card>

      {v.needsCustomPlan && v.status !== "FREE" && (
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Mail size={16} /> Your gym is larger than our standard plan
          </div>
          <p className="text-sm text-muted">
            The flat price is for small boutique gyms (up to {v.smallMax} coaches). With {v.coaches} active coaches, we agree the price with you. Tell us a little about your gym and we&apos;ll email you.
          </p>
          {v.planRequested || sent ? (
            <Notice tone="success">We have your request and will be in touch by email. You can keep using your free month meanwhile.</Notice>
          ) : (
            <>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="Optional: how many coaches and members, and anything we should know." />
              <Button onClick={() => void ask()} disabled={!!busy}>
                {busy === "ask" ? "Sending…" : "Ask for a custom plan"}
              </Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
