"use client";

import { Banknote, CheckCircle2, CreditCard, Download, ExternalLink, LoaderCircle, Pencil, Plus, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { OrderRow, RecordModal, usePayments } from "@/components/payments/PayActions";
import { Badge, Button, Card, ConfirmDialog, Field, Input, Notice, SectionTitle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { sgd } from "@/lib/payments";
import { creditsText, type PackageRec } from "@/lib/paymentsApi";
import { api } from "@/lib/store";

/*
 * Settings, Payments (coaches). Connect your own Stripe account (cards, Apple Pay, Google Pay, PayNow), add a PayNow number for the no-fee
 * option, set up the packages you sell, and see every payment. CoachFlow takes nothing from any of it.
 */

export function PaymentsSection() {
  // Coming back from Stripe's setup pages (?return=1 or ?refresh=1): read the account's state straight away.
  const [back] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      return q.get("return") === "1" || q.get("refresh") === "1";
    } catch {
      return false;
    }
  });
  const { data, error, reload } = usePayments(back);
  const { clients } = useViewer();
  const [busy, setBusy] = useState<"" | "connect" | "disconnect" | "refresh" | "paynow">("");
  const [err, setErr] = useState<string | null>(null);
  const [confirmDisc, setConfirmDisc] = useState(false);
  const [paynow, setPaynow] = useState<string | null>(null);
  const [paynowSaved, setPaynowSaved] = useState(false);
  const [record, setRecord] = useState(false);

  if (error && !data) return <Notice tone="error">{error}</Notice>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <LoaderCircle size={16} className="animate-spin" /> Loading…
      </div>
    );
  }
  const { state, packages, orders, totals } = data;
  const pn = paynow ?? state.paynow ?? "";

  const connect = async () => {
    setBusy("connect");
    setErr(null);
    const r = await api<{ url: string }>("/api/payments/connect", { body: {} });
    if (!r.ok || !r.data) {
      setBusy("");
      return setErr(r.error ?? "Couldn't reach Stripe.");
    }
    window.location.assign(r.data.url);
  };
  const savePaynow = async () => {
    setBusy("paynow");
    setErr(null);
    const r = await api("/api/payments/settings", { method: "PATCH", body: { paynow: pn } });
    setBusy("");
    if (!r.ok) return setErr(r.error ?? "Couldn't save that.");
    setPaynow(null);
    setPaynowSaved(true);
    setTimeout(() => setPaynowSaved(false), 2000);
    reload();
  };

  return (
    <div className="space-y-8">
      <Notice tone="info">
        <span className="font-semibold">CoachFlow takes 0% of what your clients pay you.</span> The money goes straight to you, never through us. Stripe charges its own fee for card payments (about 3.4% + S$0.50, and about 1.3% for PayNow). Paying you by PayNow directly or in cash has no fee at all.
      </Notice>
      {err && <Notice tone="error">{err}</Notice>}

      <section className="space-y-3">
        <SectionTitle>Card and PayNow through Stripe</SectionTitle>
        <Card className="space-y-3 p-5">
          {!state.serverReady ? (
            <p className="text-sm text-muted">Card payments through Stripe are coming soon. For now your clients can pay you by PayNow directly (no fees), and you can record cash or a bank transfer below.</p>
          ) : state.stripeReady ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 size={18} className="text-success" />
                <span className="font-semibold">Your Stripe account is connected</span>
                {state.payoutsEnabled ? <Badge className="border-success/30 bg-success/15 text-success">Payouts on</Badge> : <Badge className="border-pr/30 bg-pr/15 text-pr">Payouts not on yet</Badge>}
              </div>
              <p className="text-sm text-muted">Clients can pay by card, Apple Pay or Google Pay, and by PayNow if you turn it on in your Stripe dashboard (Settings, Payment methods). Refunds, disputes and payouts are handled in your own Stripe account.</p>
              <div className="flex flex-wrap gap-2">
                <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line bg-field px-3 text-xs font-semibold hover:bg-line">
                  Open Stripe <ExternalLink size={12} />
                </a>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDisc(true)}>
                  Disconnect
                </Button>
              </div>
            </>
          ) : state.connected ? (
            <>
              <div className="font-semibold">Finish setting up Stripe</div>
              <p className="text-sm text-muted">Your Stripe account is created but not ready to take payments yet. Stripe needs a few details from you (identity and bank account). It takes a few minutes.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void connect()} disabled={busy === "connect"}>
                  {busy === "connect" ? <LoaderCircle size={16} className="animate-spin" /> : <CreditCard size={16} />} Continue on Stripe
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy === "refresh"}
                  onClick={async () => {
                    setBusy("refresh");
                    await api("/api/payments?refresh=1");
                    setBusy("");
                    reload();
                  }}
                >
                  <RefreshCw size={16} /> I have finished, check again
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold">Get paid by card in the app</div>
              <p className="text-sm text-muted">Connect your own Stripe account (or make one, free). Clients then buy packages in the app and the money lands in your Stripe account and your bank. We never hold it and take no cut.</p>
              <Button onClick={() => void connect()} disabled={busy === "connect"}>
                {busy === "connect" ? <LoaderCircle size={16} className="animate-spin" /> : <CreditCard size={16} />} Connect Stripe
              </Button>
            </>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>PayNow directly (no fees)</SectionTitle>
        <Card className="space-y-3 p-5">
          <p className="text-sm text-muted">Give your PayNow mobile number or UEN. A client who picks this pays you from their banking app with a reference, taps “I have paid”, and you confirm it once you see it arrive. Then their credits are added.</p>
          <Field label="PayNow number or UEN">
            <div className="flex gap-2">
              <Input value={pn} onChange={(e) => setPaynow(e.target.value)} inputMode="tel" placeholder="9123 4567" className="max-w-xs" />
              <Button variant="secondary" onClick={() => void savePaynow()} disabled={busy === "paynow" || pn === (state.paynow ?? "")}>
                <Smartphone size={16} /> Save
              </Button>
              {paynowSaved && <span className="self-center text-sm text-success">Saved</span>}
            </div>
          </Field>
        </Card>
      </section>

      <Packages packages={packages} reload={reload} />

      <section className="space-y-3">
        <SectionTitle
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setRecord(true)} disabled={clients.length === 0}>
                <Banknote size={14} /> Record payment
              </Button>
              <a href="/api/payments/export" className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line bg-field px-3 text-xs font-semibold hover:bg-line">
                <Download size={14} /> CSV
              </a>
            </div>
          }
        >
          Payments
        </SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <Tile label="This month" value={sgd(totals.monthCents)} />
          <Tile label="All time" value={sgd(totals.paidCents)} />
          <Tile label="Waiting for you" value={String(totals.awaiting)} hint={totals.awaiting ? "PayNow to confirm" : undefined} />
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-muted">No payments yet. Send a payment link from a client’s Sessions tab, or let clients buy in the app.</p>
        ) : (
          <Card className="divide-y divide-line">
            {orders.slice(0, 60).map((o) => (
              <OrderRow key={o.id} o={o} showClient onChanged={reload} />
            ))}
          </Card>
        )}
      </section>

      {record && <RecordModal open onClose={() => setRecord(false)} packages={packages} clients={clients.filter((c) => !c.profile.archived).map((c) => ({ id: c.user.id, name: c.user.name }))} onDone={reload} />}
      <ConfirmDialog
        open={confirmDisc}
        onClose={() => setConfirmDisc(false)}
        title="Disconnect Stripe?"
        message="Clients can't pay by card until you connect again. Your Stripe account and its money are not touched, and your records here stay."
        confirmLabel="Disconnect"
        onConfirm={async () => {
          setBusy("disconnect");
          const r = await api("/api/payments/connect", { method: "DELETE" });
          setBusy("");
          if (!r.ok) setErr(r.error ?? "Couldn't disconnect.");
          reload();
        }}
      />
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      {hint && <div className="text-xs text-accent">{hint}</div>}
    </Card>
  );
}

/* ---------------- Packages ---------------- */
function Packages({ packages, reload }: { packages: PackageRec[]; reload: () => void }) {
  const [editing, setEditing] = useState<PackageRec | "new" | null>(null);
  const [removing, setRemoving] = useState<PackageRec | null>(null);
  const active = packages.filter((p) => p.active);
  return (
    <section className="space-y-3">
      <SectionTitle
        action={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={14} /> Add package
          </Button>
        }
      >
        Packages you sell
      </SectionTitle>
      {active.length === 0 && editing === null && <p className="text-sm text-muted">Add the packages clients can buy, like “10 sessions” for S$800. Credits are added the moment a payment is in.</p>}
      {active.length > 0 && (
        <Card className="divide-y divide-line">
          {active.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-muted">{creditsText(p.sessions, p.groupCredits)}</div>
              </div>
              <div className="font-bold">{sgd(p.priceCents)}</div>
              <Button size="sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                <Pencil size={14} />
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => setRemoving(p)}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </Card>
      )}
      {editing !== null && <PackageForm key={editing === "new" ? "new" : editing.id} pkg={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Stop selling ${removing?.name ?? ""}?`}
        message="Clients can't buy it any more. Payments already made keep their record."
        confirmLabel="Stop selling"
        onConfirm={async () => {
          if (!removing) return;
          await api(`/api/payments/packages/${removing.id}`, { method: "DELETE" });
          reload();
        }}
      />
    </section>
  );
}

function PackageForm({ pkg, onClose, onSaved }: { pkg: PackageRec | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(pkg?.name ?? "");
  const [sessions, setSessions] = useState(String(pkg?.sessions ?? 10));
  const [group, setGroup] = useState(String(pkg?.groupCredits ?? 0));
  const [price, setPrice] = useState(pkg ? String(pkg.priceCents / 100) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = { name, sessions: Number(sessions), groupCredits: Number(group), price: Number(price) };
    const r = pkg ? await api(`/api/payments/packages/${pkg.id}`, { method: "PUT", body }) : await api("/api/payments/packages", { body });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Couldn't save that.");
    onSaved();
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="font-semibold">{pkg ? "Change package" : "New package"}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="10 sessions" autoFocus />
        </Field>
        <Field label="Price (S$)">
          <Input type="number" inputMode="decimal" min={1} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="800" />
        </Field>
        <Field label="Sessions">
          <Input type="number" min={0} max={500} value={sessions} onChange={(e) => setSessions(e.target.value)} />
        </Field>
        <Field label="Group class credits (optional)">
          <Input type="number" min={0} max={500} value={group} onChange={(e) => setGroup(e.target.value)} />
        </Field>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={busy || !name.trim() || !price}>
          Save package
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
