"use client";

import { CheckCircle2, Flag, Lightbulb, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { money, REFUND_LABEL, SANCTION_LABEL, type RefundChoice, type Sanction } from "@/lib/consults";
import type { AdminConsults, AdminReport } from "@/lib/consultsApi";
import { api } from "@/lib/store";
import { cn } from "@/lib/utils";

const when = (iso: string) => new Date(iso).toLocaleString("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Admin, Consults: reports to decide (with what the app saw and a recommended action), recent consults, money, and suspensions. */
export function ConsultsPanel() {
  const [data, setData] = useState<AdminConsults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<AdminConsults>("/api/admin/consults");
    if (r.ok && r.data) setData(r.data);
    else setError(r.error ?? "Couldn't load consults.");
  }, []);
  useEffect(() => {
    let alive = true;
    void api<AdminConsults>("/api/admin/consults").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setData(r.data);
      else setError(r.error ?? "Couldn’t load consults.");
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!data) return <p className="text-sm text-muted">{error ?? "Loading…"}</p>;
  const open = data.reports.filter((r) => r.status === "OPEN");
  const decided = data.reports.filter((r) => r.status !== "OPEN");
  return (
    <div className="space-y-6">
      {!data.ready && <Notice tone="info">Consults aren’t switched on yet: they need DAILY_API_KEY (the video service) and Stripe Connect (CONNECT_ENABLED=1). See README, Consult a trainer.</Notice>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Total label="Consults held" value={String(data.totals.done)} />
        <Total label="Paid by people" value={money(data.totals.grossCents)} />
        <Total label="To trainers" value={money(data.totals.trainerCents)} hint={data.totals.refundedCents ? `${money(data.totals.refundedCents)} refunded` : undefined} />
        <Total label="CoachFlow keeps" value={money(data.totals.keptCents)} hint="before Stripe's card fee" />
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
          <Flag size={15} /> Reports to decide {open.length > 0 && <Badge className="border-danger/30 bg-danger/10 text-danger">{open.length}</Badge>}
        </h2>
        {open.length === 0 ? <p className="text-sm text-muted">Nothing to decide.</p> : open.map((r) => <ReportCard key={r.id} r={r} onDone={load} />)}
      </section>

      {data.blocked.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
            <ShieldOff size={15} /> Suspended or blocked from consults
          </h2>
          {data.blocked.map((b) => (
            <Card key={b.userId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div>
                <span className="font-semibold">{b.name}</span> <span className="text-muted">· {b.role} · since {when(b.since)}</span>
                {b.reason && <div className="text-xs text-muted">{b.reason}</div>}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await api(`/api/admin/consults/blocks/${encodeURIComponent(b.userId)}`, { method: "DELETE" });
                  await load();
                }}
              >
                Lift
              </Button>
            </Card>
          ))}
        </section>
      )}

      {decided.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Decided in the last 30 days</h2>
          {decided.map((r) => (
            <Card key={r.id} className="p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span>
                  <span className="font-semibold">{r.reasonLabel}</span> <span className="text-muted">· by {r.reporterName} ({r.reporterRole === "SOLO" ? "client" : "trainer"}) · {when(r.createdAt)}</span>
                </span>
                {r.resolution && (
                  <span className="text-xs">
                    {r.resolution.refund === "none" ? "No refund" : `${money(r.resolution.refundCents)} refunded`} · {SANCTION_LABEL[r.resolution.sanction]}
                  </span>
                )}
              </div>
              {r.resolution?.note && <div className="mt-1 text-xs text-muted">{r.resolution.note}</div>}
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Recent consults</h2>
        {data.recent.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-field text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Trainer</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Money</th>
                  <th className="px-3 py-2">Rating</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-3 py-2 text-xs">{when(c.createdAt)}</td>
                    <td className="px-3 py-2">{c.person}</td>
                    <td className="px-3 py-2">{c.trainer ?? <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2 text-xs">
                      {c.status}
                      {c.reported && <Badge className="ml-1 border-danger/30 bg-danger/10 text-danger">reported</Badge>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {c.status === "DONE" || c.status === "LIVE" ? `${money(c.priceCents - c.refundedCents)} · trainer ${money(c.trainerCents)} (${c.payoutStatus.toLowerCase()})` : "not charged"}
                    </td>
                    <td className="px-3 py-2 text-xs">{c.stars ? `${c.stars}★` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Total({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </Card>
  );
}

function ReportCard({ r, onDone }: { r: AdminReport; onDone: () => Promise<void> }) {
  const rec = r.recommendation;
  const left = r.consult.priceCents - r.consult.refundedCents;
  const [refund, setRefund] = useState<RefundChoice>(rec.refund);
  const [amount, setAmount] = useState(String((rec.refundCents || 2500) / 100));
  const [sanction, setSanction] = useState<Sanction>(rec.sanction);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = r.facts;
  const sanctions: Sanction[] = r.trainer ? ["none", "warn_trainer", "suspend_trainer", "warn_person", "block_person"] : ["none", "warn_person", "block_person"];
  const matches = refund === rec.refund && sanction === rec.sanction && (refund !== "partial" || Math.round(Number(amount) * 100) === rec.refundCents);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{r.reasonLabel}</div>
          <div className="text-xs text-muted">
            Reported by {r.reporterName} ({r.reporterRole === "SOLO" ? "the client" : "the trainer"}) · {when(r.createdAt)}
          </div>
        </div>
        <div className="text-right text-xs text-muted">
          <div>
            Client: <span className="font-semibold text-ink">{r.person.name}</span>
          </div>
          <div>
            Trainer: <span className="font-semibold text-ink">{r.trainer?.name ?? "—"}</span>
          </div>
        </div>
      </div>
      {r.details && <p className="whitespace-pre-wrap rounded-xl bg-field p-3 text-sm">“{r.details}”</p>}

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <Fact ok={f.trainerJoined} text={f.trainerJoined ? "The trainer opened the call" : "The trainer never opened the call"} />
        <Fact ok={f.personJoined} text={f.personJoined ? "The client opened the call" : "The client never opened the call"} />
        <Fact ok={f.minutes >= 45} text={`It ran for about ${f.minutes} minute${f.minutes === 1 ? "" : "s"}${f.endedBy ? `, ended early by the ${f.endedBy === "SOLO" ? "client" : "trainer"}` : ""}`} />
        <Fact ok={f.trainerUpheld === 0 && f.personUpheld === 0} text={`Earlier upheld reports: trainer ${f.trainerUpheld}, client ${f.personUpheld}`} />
        <div className="text-muted sm:col-span-2">
          Paid {money(r.consult.priceCents)}
          {r.consult.refundedCents ? `, ${money(r.consult.refundedCents)} already refunded` : ""} · trainer’s share {money(r.consult.trainerCents)} ({r.consult.payoutStatus === "PAID" ? "already paid: a refund takes their part back" : "on hold until you decide"})
        </div>
        {r.consult.question && <div className="text-muted sm:col-span-2">They asked: “{r.consult.question}”</div>}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm">
        <Lightbulb size={18} className="mt-0.5 shrink-0 text-accent" />
        <div>
          <div className="font-semibold">
            Recommended: {rec.refund === "partial" ? `refund ${money(rec.refundCents)}` : REFUND_LABEL[rec.refund]}
            {rec.sanction !== "none" ? ` · ${SANCTION_LABEL[rec.sanction]}` : ""}
          </div>
          <div className="text-xs text-muted">{rec.why}</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Money">
          <Select value={refund} onChange={(e) => setRefund(e.target.value as RefundChoice)}>
            {(["none", "partial", "full"] as RefundChoice[]).map((x) => (
              <option key={x} value={x}>
                {x === "full" ? `Full refund (${money(left)}; the trainer isn't paid)` : REFUND_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
        {refund === "partial" ? (
          <Field label="Refund amount (S$)" hint={`Up to ${money(left - 100)}. The trainer keeps 70% of what's left.`}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
        ) : (
          <div />
        )}
        <Field label="Action">
          <Select value={sanction} onChange={(e) => setSanction(e.target.value as Sanction)}>
            {sanctions.map((x) => (
              <option key={x} value={x}>
                {SANCTION_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" hint="Sent with the decision (and with any warning).">
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await api(`/api/admin/consults/reports/${encodeURIComponent(r.id)}`, { body: { refund, refundCents: refund === "partial" ? Math.round(Number(amount) * 100) : 0, sanction, note } });
            setBusy(false);
            if (!res.ok) return setError(res.error ?? "Couldn't save the decision.");
            await onDone();
          }}
        >
          <CheckCircle2 size={16} /> Decide
        </Button>
        {!matches && (
          <button
            type="button"
            className="text-xs font-semibold text-accent"
            onClick={() => {
              setRefund(rec.refund);
              setSanction(rec.sanction);
              setAmount(String((rec.refundCents || 2500) / 100));
            }}
          >
            Use the recommendation
          </button>
        )}
      </div>
    </Card>
  );
}

function Fact({ ok, text }: { ok: boolean; text: string }) {
  return <div className={cn("rounded-lg px-2 py-1.5", ok ? "bg-success/10 text-success" : "bg-pr/10 text-pr")}>{text}</div>;
}
