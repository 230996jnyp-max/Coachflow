"use client";

import { Check, Copy, CreditCard, LoaderCircle, Smartphone } from "lucide-react";
import { use, useEffect, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { sgd } from "@/lib/payments";
import { creditsText, type PublicOrderRec } from "@/lib/paymentsApi";
import { api } from "@/lib/store";

/**
 * The page a payment link opens. No account is needed: the link is the secret, so a parent or guardian can pay too. Card and PayNow
 * go through the coach's own Stripe account; "PayNow directly" is a transfer to the coach that they confirm.
 */
export default function PayLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [order, setOrder] = useState<PublicOrderRec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "card" | "paynow">("");
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [returned] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("paid") === "1";
    } catch {
      return false;
    }
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api<{ order: PublicOrderRec }>(`/api/pay/${token}`);
      if (!live) return;
      if (!r.ok || !r.data) return setError(r.error ?? "That payment link isn't valid.");
      setOrder(r.data.order);
    })();
    return () => {
      live = false;
    };
  }, [token, tick]);

  // Back from Stripe: the confirmation can take a few seconds, so look again for a short while.
  const waiting = returned && order && order.status !== "PAID" && tick < 20;
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setTick((n) => n + 1), 3000);
    return () => clearTimeout(t);
  }, [waiting, tick]);

  const card = async () => {
    setBusy("card");
    setError(null);
    const r = await api<{ url: string }>(`/api/pay/${token}`, { body: { action: "card" } });
    if (!r.ok || !r.data) {
      setBusy("");
      return setError(r.error ?? "Couldn't open the payment page.");
    }
    window.location.assign(r.data.url);
  };
  const paynow = async () => {
    setBusy("paynow");
    setError(null);
    const r = await api(`/api/pay/${token}`, { body: { action: "paynow" } });
    setBusy("");
    if (!r.ok) return setError(r.error ?? "Couldn't tell your coach.");
    setSent(true);
  };

  const done = order?.status === "PAID";
  const closed = order && (order.status === "CANCELLED" || order.status === "REFUNDED" || order.expired) && !done;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-8">
      <div className="text-center text-sm font-semibold uppercase tracking-wider text-muted">CoachFlow</div>
      {!order && !error && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted">
          <LoaderCircle size={16} className="animate-spin" /> Loading…
        </div>
      )}
      {error && !order && <Notice tone="error">{error}</Notice>}
      {order && (
        <Card className="space-y-4 p-6">
          <div>
            <div className="text-sm text-muted">
              {order.coachName}
              {order.clientFirstName ? ` · for ${order.clientFirstName}` : ""}
            </div>
            <h1 className="text-xl font-bold">{order.name}</h1>
            <div className="text-sm text-muted">{creditsText(order.sessions, order.groupCredits)}</div>
          </div>
          <div className="text-3xl font-bold">{sgd(order.amountCents)}</div>

          {done && (
            <Notice tone="success">
              <span className="flex items-start gap-2">
                <Check size={16} className="mt-0.5 shrink-0" /> Paid. Thank you! The credits have been added.
              </span>
            </Notice>
          )}
          {returned && !done && !closed && (
            <Notice tone="info">
              <span className="flex items-center gap-2">
                <LoaderCircle size={14} className="animate-spin" /> Thanks. Confirming your payment…
              </span>
            </Notice>
          )}
          {closed && <Notice tone="warn">{order.status === "REFUNDED" ? "This payment was refunded." : "This link is no longer open. Ask your coach for a new one."}</Notice>}

          {!done && !closed && (
            <div className="space-y-3">
              {order.stripeReady && (
                <Button className="w-full" size="lg" onClick={() => void card()} disabled={!!busy}>
                  {busy === "card" ? <LoaderCircle size={18} className="animate-spin" /> : <CreditCard size={18} />} Pay by card or PayNow
                </Button>
              )}
              {order.paynow && (
                <div className="space-y-3 rounded-xl border border-line p-4">
                  <div className="flex items-center gap-2 font-semibold">
                    <Smartphone size={16} /> {order.stripeReady ? "Or pay your coach directly by PayNow" : "Pay by PayNow"}
                  </div>
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Send to</dt>
                      <dd className="font-mono font-semibold">{order.paynow}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Amount</dt>
                      <dd className="font-semibold">{sgd(order.amountCents)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Reference</dt>
                      <dd className="font-mono font-semibold">{order.ref}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted">Type the reference in the PayNow message so your coach can match it. No fees for you.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(order.ref);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        } catch {
                          /* ignore */
                        }
                      }}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy reference"}
                    </Button>
                    {sent || order.status === "AWAITING" ? (
                      <span className="inline-flex min-h-9 items-center text-sm text-success">Thanks. {order.coachName} will confirm it soon.</span>
                    ) : (
                      <Button size="sm" onClick={() => void paynow()} disabled={!!busy}>
                        {busy === "paynow" ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />} I have sent it
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {!order.stripeReady && !order.paynow && <Notice tone="warn">Your coach hasn’t switched on payments yet. Please ask them how to pay.</Notice>}
            </div>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </Card>
      )}
      <p className="text-center text-xs text-muted">Your payment goes straight to {order?.coachName ?? "your coach"}. CoachFlow takes no cut and never sees your card details.</p>
    </main>
  );
}
