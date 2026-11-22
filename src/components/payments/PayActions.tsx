"use client";

import { format, parseISO } from "date-fns";
import { Banknote, Check, Copy, ExternalLink, Link2, LoaderCircle, MessageCircle, Receipt, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ConfirmDialog, Field, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { MANUAL_KINDS, STATUS_LABEL, estimateStripeFeeCents, sgd } from "@/lib/payments";
import { creditsText, type OrderRec, type PackageRec, type PaymentStateRec, type TotalsRec } from "@/lib/paymentsApi";
import { api } from "@/lib/store";
import { cn } from "@/lib/utils";

/*
 * What a coach does with payments next to a client: send a pay link, record a payment they received themselves, and the list of
 * payments with confirm, refund and cancel. Also used on the Settings, Payments screen.
 */

export interface PaymentsData {
  state: PaymentStateRec;
  packages: PackageRec[];
  orders: OrderRec[];
  totals: TotalsRec;
}

/** Loads the coach's payment setup, packages and payments, and reloads on demand. */
export function usePayments(refreshOnLoad = false) {
  const [data, setData] = useState<PaymentsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api<PaymentsData>(`/api/payments${refreshOnLoad && rev === 0 ? "?refresh=1" : ""}`);
      if (!live) return;
      if (!r.ok || !r.data) return setError(r.error ?? "Couldn't load payments.");
      setError(null);
      setData(r.data);
    })();
    return () => {
      live = false;
    };
  }, [rev, refreshOnLoad]);
  return { data, error, reload: () => setRev((n) => n + 1) };
}

const day = (iso: string | null) => {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/* ---------------- Send a pay link ---------------- */
export function SendLinkModal({ open, onClose, clientId, clientName, packages, onDone }: { open: boolean; onClose: () => void; clientId: string; clientName: string; packages: PackageRec[]; onDone: () => void }) {
  const active = packages.filter((p) => p.active);
  const [pkg, setPkg] = useState(active[0]?.id ?? "");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!open) return null;
  const chosen = active.find((p) => p.id === pkg);
  const first = clientName.split(" ")[0];

  const make = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ path: string }>("/api/payments/orders", { body: { clientId, packageId: pkg } });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "Couldn't make the link.");
    setLink(`${window.location.origin}${r.data.path}`);
    onDone();
  };
  const message = link && chosen ? `Hi ${first}, here is your link to pay for ${chosen.name} (${sgd(chosen.priceCents)}): ${link}` : "";

  return (
    <Modal
      open
      onClose={onClose}
      title={`Payment link for ${first}`}
      footer={
        link ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void make()} disabled={busy || !pkg}>
              {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Link2 size={16} />} Make the link
            </Button>
          </>
        )
      }
    >
      {active.length === 0 ? (
        <Notice tone="warn">
          You have no packages yet. Add one in{" "}
          <Link href="/settings/payments" className="underline">
            Settings, Payments
          </Link>
          .
        </Notice>
      ) : link ? (
        <div className="space-y-3">
          <Notice tone="success">The link is ready. Whoever opens it can pay without an account, so it also works for a parent or guardian. It stays valid for 14 days.</Notice>
          <pre className="whitespace-pre-wrap break-all rounded-xl border border-line bg-field p-3 font-mono text-xs">{link}</pre>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                if (await copyText(message)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy message"}
            </Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-field px-4 text-sm font-semibold hover:bg-line">
              <MessageCircle size={16} /> WhatsApp
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Package">
            <Select value={pkg} onChange={(e) => setPkg(e.target.value)}>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {sgd(p.priceCents)}
                </option>
              ))}
            </Select>
          </Field>
          {chosen && (
            <p className="text-sm text-muted">
              {first} gets {creditsText(chosen.sessions, chosen.groupCredits)} once the payment is in. You keep the whole amount; CoachFlow takes nothing.
            </p>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Record a payment received ---------------- */
export function RecordModal({
  open,
  onClose,
  packages,
  clients,
  clientId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  packages: PackageRec[];
  /** When no client is fixed, the coach picks one. */
  clients?: { id: string; name: string }[];
  clientId?: string;
  onDone: () => void;
}) {
  const active = packages.filter((p) => p.active);
  const [who, setWho] = useState(clientId ?? clients?.[0]?.id ?? "");
  const [pkg, setPkg] = useState(active[0]?.id ?? "custom");
  const [kind, setKind] = useState<string>("Cash");
  const [name, setName] = useState("");
  const [sessions, setSessions] = useState("1");
  const [group, setGroup] = useState("0");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const custom = pkg === "custom";

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = custom ? { clientId: who, manual: true, kind, note, name, sessions: Number(sessions), groupCredits: Number(group), price: Number(price) } : { clientId: who, manual: true, kind, note, packageId: pkg };
    const r = await api("/api/payments/orders", { body });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Couldn't record that.");
    onDone();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a payment you received"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !who || (custom && (!name.trim() || !price))}>
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Banknote size={16} />} Record and add credits
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">For cash, a bank transfer or a PayNow you saw arrive. The credits are added straight away and it shows in your records.</p>
        {!clientId && clients && (
          <Field label="Client">
            <Select value={who} onChange={(e) => setWho(e.target.value)}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="What was bought">
          <Select value={pkg} onChange={(e) => setPkg(e.target.value)}>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {sgd(p.priceCents)}
              </option>
            ))}
            <option value="custom">Something else…</option>
          </Select>
        </Field>
        {custom && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Workshop" />
            </Field>
            <Field label="Amount paid (S$)">
              <Input type="number" inputMode="decimal" min={1} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Sessions to add">
              <Input type="number" min={0} max={500} value={sessions} onChange={(e) => setSessions(e.target.value)} />
            </Field>
            <Field label="Group class credits to add">
              <Input type="number" min={0} max={500} value={group} onChange={(e) => setGroup(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="How it was paid">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {MANUAL_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note (private, optional)">
          <Textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ---------------- One payment in a list ---------------- */
const TONE: Record<string, string> = {
  PAID: "border-success/30 bg-success/15 text-success",
  AWAITING: "border-accent/30 bg-accent/15 text-accent",
  PENDING: "border-pr/30 bg-pr/15 text-pr",
  REFUNDED: "border-danger/30 bg-danger/15 text-danger",
  CANCELLED: "",
};

export function OrderRow({ o, showClient, onChanged }: { o: OrderRec; showClient: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<"" | "confirm" | "refund" | "cancel">("");
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const act = async (action: "confirm" | "refund" | "cancel") => {
    setBusy(action);
    setError(null);
    const r = await api(`/api/payments/orders/${o.id}`, { method: "PATCH", body: { action } });
    setBusy("");
    if (!r.ok) return setError(r.error ?? "That didn't work.");
    onChanged();
  };
  const via = o.method === "STRIPE" ? "Stripe" : o.method === "PAYNOW" ? "PayNow" : (o.manualKind ?? "Recorded");
  const label = o.expired ? "Link expired" : STATUS_LABEL[o.status];
  const fee = o.method === "STRIPE" && o.status === "PAID" ? estimateStripeFeeCents(o.amountCents) : 0;

  return (
    <div className="space-y-2 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {showClient ? `${o.clientName} · ` : ""}
            {o.name}
          </div>
          <div className="text-xs text-muted">
            {creditsText(o.sessions, o.groupCredits)} · {via} · {day(o.paidAt ?? o.createdAt)} · {o.ref}
          </div>
          {o.note && <div className="mt-1 text-xs text-muted">Note: {o.note}</div>}
          {fee > 0 && <div className="mt-1 text-xs text-muted">Stripe takes about {sgd(fee)} of this. CoachFlow takes nothing.</div>}
        </div>
        <div className="text-right">
          <div className={cn("font-bold", o.status === "REFUNDED" && "text-muted line-through")}>{sgd(o.amountCents)}</div>
          <Badge className={TONE[o.status] ?? ""}>{label}</Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {o.status === "AWAITING" && (
          <Button size="sm" disabled={!!busy} onClick={() => void act("confirm")}>
            <Check size={14} /> I received it
          </Button>
        )}
        {o.status === "PENDING" && o.method !== "MANUAL" && !o.expired && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                if (await copyText(`${window.location.origin}/pay/${o.token}`)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy link"}
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act("cancel")}>
              <X size={14} /> Cancel
            </Button>
          </>
        )}
        {o.status === "PAID" && (
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setConfirmRefund(true)}>
            <Undo2 size={14} /> Refund
          </Button>
        )}
        {o.receiptUrl && (
          <a href={o.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-xl px-3 text-xs font-semibold text-muted hover:text-ink">
            <Receipt size={14} /> Receipt <ExternalLink size={12} />
          </a>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <ConfirmDialog
        open={confirmRefund}
        onClose={() => setConfirmRefund(false)}
        danger
        title="Refund this payment?"
        message={`${sgd(o.amountCents)} goes back to ${o.clientName}${o.method === "STRIPE" ? " through Stripe" : " (you return it yourself, since it was not paid through the app)"}. Credits that are still unused are taken back (${creditsText(o.sessions, o.groupCredits)} at most).`}
        confirmLabel="Refund"
        onConfirm={() => void act("refund")}
      />
    </div>
  );
}

/* ---------------- On a client's page ---------------- */
/** The "Payments" part of a client's Sessions tab: send a link, record a payment, and that client's payments. */
export function ClientPayments({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { data, error, reload } = usePayments();
  const [link, setLink] = useState(false);
  const [record, setRecord] = useState(false);
  if (error && !data) return null;
  if (!data) return null;
  const mine = data.orders.filter((o) => o.clientId === clientId);
  const canLink = data.state.stripeReady || !!data.state.paynow;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Payments</h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setRecord(true)}>
            <Banknote size={14} /> Record payment
          </Button>
          <Button size="sm" onClick={() => setLink(true)} disabled={!canLink}>
            <Link2 size={14} /> Send payment link
          </Button>
        </div>
      </div>
      {!canLink && (
        <p className="text-xs text-muted">
          To send links, switch on card payments or add your PayNow number in{" "}
          <Link href="/settings/payments" className="underline">
            Settings, Payments
          </Link>
          . You can still record cash and transfers.
        </p>
      )}
      {mine.length > 0 && <Card className="divide-y divide-line">{mine.slice(0, 8).map((o) => <OrderRow key={o.id} o={o} showClient={false} onChanged={reload} />)}</Card>}
      {link && <SendLinkModal open onClose={() => setLink(false)} clientId={clientId} clientName={clientName} packages={data.packages} onDone={reload} />}
      {record && <RecordModal open onClose={() => setRecord(false)} packages={data.packages} clientId={clientId} onDone={reload} />}
    </section>
  );
}
