"use client";

import { format, parseISO } from "date-fns";
import { ExternalLink, LoaderCircle, Receipt, ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { STATUS_LABEL, sgd } from "@/lib/payments";
import { creditsText, type BuyOptionsRec, type OrderRec } from "@/lib/paymentsApi";
import { api } from "@/lib/store";

const day = (iso: string | null) => {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
};

/** A client's page for buying a package from their coach and seeing what they paid. */
export default function PayPage() {
  const { user, isTrainer, db } = useViewer();
  const [options, setOptions] = useState<BuyOptionsRec | null | undefined>(undefined);
  const [orders, setOrders] = useState<OrderRec[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => {
    if (!user || isTrainer) return;
    let live = true;
    void (async () => {
      const r = await api<{ options: BuyOptionsRec | null; orders: OrderRec[] }>("/api/payments");
      if (!live) return;
      if (!r.ok || !r.data) return setError(r.error ?? "Couldn't load payments.");
      setOptions(r.data.options);
      setOrders(r.data.orders);
    })();
    return () => {
      live = false;
    };
  }, [user, isTrainer]);

  if (!user || isTrainer) return null;
  const profile = db.clients.find((c) => c.id === user.id);

  const buy = async (packageId: string) => {
    setBuying(packageId);
    setError(null);
    const r = await api<{ url: string | null; path: string }>("/api/payments/orders", { body: { packageId } });
    if (!r.ok || !r.data) {
      setBuying(null);
      return setError(r.error ?? "Couldn't start that.");
    }
    // Card only: straight to Stripe. With PayNow too, the pay page lets them choose.
    window.location.assign(r.data.url && !options?.paynow ? r.data.url : r.data.path);
  };

  return (
    <div className="space-y-8">
      <PageHeader title="Buy sessions" subtitle={profile ? `You have ${profile.credits} session${profile.credits === 1 ? "" : "s"} left` : undefined} />
      {error && <Notice tone="error">{error}</Notice>}
      {options === undefined && !error && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle size={16} className="animate-spin" /> Loading…
        </div>
      )}
      {options === null && <EmptyState icon={<ShoppingBag size={28} />} title="Your coach hasn't switched on payments in the app" hint="Ask them how to pay for more sessions. Once they do, you'll see their packages here." />}
      {options && (
        <section className="space-y-3">
          <SectionTitle>{options.coachName}’s packages</SectionTitle>
          {options.minor && <Notice tone="info">You’re under 18, so a parent or guardian pays. Ask your coach to send them a payment link.</Notice>}
          <div className="grid gap-3 sm:grid-cols-2">
            {options.packages.map((p) => (
              <Card key={p.id} className="space-y-2 p-4">
                <div className="font-semibold">{p.name}</div>
                <div className="text-sm text-muted">{creditsText(p.sessions, p.groupCredits)}</div>
                <div className="text-2xl font-bold">{sgd(p.priceCents)}</div>
                <Button className="w-full" disabled={options.minor || buying === p.id} onClick={() => void buy(p.id)}>
                  {buying === p.id ? <LoaderCircle size={16} className="animate-spin" /> : null} Buy
                </Button>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted">
            {options.stripeReady ? "Pay by card, Apple Pay or Google Pay on Stripe's secure page" : ""}
            {options.stripeReady && options.paynow ? ", or " : ""}
            {options.paynow ? `${options.stripeReady ? "" : "Pay "}by PayNow straight to your coach` : ""}. Your credits are added as soon as the payment is confirmed.
          </p>
        </section>
      )}
      {orders.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Your payments</SectionTitle>
          <Card className="divide-y divide-line">
            {orders.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{o.name}</div>
                  <div className="text-xs text-muted">
                    {creditsText(o.sessions, o.groupCredits)} · {day(o.paidAt ?? o.createdAt)} · {o.ref}
                  </div>
                  {o.status === "PENDING" && !o.expired && (
                    <a href={`/pay/${o.token}`} className="text-xs font-semibold text-accent underline">
                      Finish paying
                    </a>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-bold">{sgd(o.amountCents)}</div>
                  <Badge>{o.expired ? "Link expired" : STATUS_LABEL[o.status]}</Badge>
                </div>
                {o.receiptUrl && (
                  <a href={o.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
                    <Receipt size={14} /> Receipt <ExternalLink size={12} />
                  </a>
                )}
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
