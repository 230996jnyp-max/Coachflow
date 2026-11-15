"use client";

import { format, parseISO } from "date-fns";
import { Check, ClipboardCheck, LoaderCircle, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { AssessmentHub } from "@/components/assessment/AssessmentHub";
import { FormFill, FormView } from "@/components/intake/FormParts";
import { Badge, Button, Card, EmptyState, Modal, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import type { FormRec, IntakeStateRec } from "@/lib/intakeApi";
import { FORM_BLURB, FORM_KINDS, FORM_LABEL, PRIVACY_NOTE, type FormData, type FormKind } from "@/lib/intakeForms";
import { api, refreshAccounts } from "@/lib/store";

const when = (iso: string | null | undefined) => {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
};

/** A client's own page for "Before we meet": the forms to fill in, the copies their coach gave them to read, and their assessments. */
export default function IntakePage() {
  const { user, isTrainer, isMinor, coach } = useViewer();
  const [state, setState] = useState<IntakeStateRec | null>(null);
  const [rev, setRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filling, setFilling] = useState<FormKind | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const hasCoach = !!coach && !isTrainer;

  useEffect(() => {
    if (!hasCoach) return;
    let live = true;
    void (async () => {
      const r = await api<{ intake: IntakeStateRec }>("/api/intake");
      if (!live) return;
      if (!r.ok || !r.data) return setError(r.error ?? "Couldn't load your forms.");
      setError(null);
      setState(r.data.intake);
    })();
    return () => {
      live = false;
    };
  }, [hasCoach, rev]);

  if (!user || isTrainer) return null;
  if (!hasCoach) {
    return (
      <div>
        <PageHeader title="Before we meet" />
        <EmptyState icon={<ClipboardCheck size={28} />} title="No coach yet" hint="Your coach sends you these forms once you're connected. They help your coach understand your health and goals before your first session." />
      </div>
    );
  }

  const reload = () => {
    setRev((n) => n + 1);
    void refreshAccounts();
  };
  const requested = new Set<FormKind>(state?.request?.kinds ?? []);
  const copies = (state?.history ?? []).filter((h) => h.sharedAt);
  const toRead = copies.filter((c) => !c.ackAt);

  const acknowledge = async (id: string) => {
    setBusy(id);
    const r = await api(`/api/intake/${id}`, { method: "PATCH", body: { acknowledge: true } });
    setBusy(null);
    if (!r.ok) return setError(r.error ?? "Couldn't save that.");
    reload();
  };

  return (
    <div className="space-y-8">
      {!detail && <PageHeader title="Before we meet" subtitle={`Short forms for ${coach?.name ?? "your coach"}`} />}
      {!detail && <p className="-mt-4 text-sm text-muted">{PRIVACY_NOTE}</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {!state && !error && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle size={16} className="animate-spin" /> Loading…
        </div>
      )}

      {!detail && toRead.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Please read and acknowledge</SectionTitle>
          {toRead.map((c) => (
            <CopyCard key={c.id} rec={c} coachName={coach?.name ?? "Your coach"} busy={busy === c.id} onAck={() => void acknowledge(c.id)} />
          ))}
        </section>
      )}

      {state && !detail && (
        <section className="space-y-3" data-tour="intake-forms">
          <SectionTitle>Your forms</SectionTitle>
          {!state.request && <p className="text-sm text-muted">Your coach hasn’t asked for these yet, but you can fill them in any time.</p>}
          {FORM_KINDS.map((k) => {
            const cur = state.current[k];
            return (
              <Card key={k} className="flex items-center gap-3 p-4">
                <ClipboardCheck size={20} className={cur ? "text-success" : "text-muted"} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{FORM_LABEL[k]}</div>
                  <div className="text-xs text-muted">{cur ? `Version ${cur.version} · ${when(cur.submittedAt)}` : FORM_BLURB[k]}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {!cur && requested.has(k) && <Badge className="border-pr/30 bg-pr/15 text-pr">Your coach asked for this</Badge>}
                    {cur && <Badge className="border-success/30 bg-success/15 text-success">Done</Badge>}
                  </div>
                </div>
                <Button size="sm" variant={cur ? "secondary" : "primary"} onClick={() => setFilling(k)}>
                  <Pencil size={14} /> {cur ? "Update" : "Fill in"}
                </Button>
              </Card>
            );
          })}
        </section>
      )}

      {!detail && copies.some((c) => c.ackAt) && (
        <section className="space-y-3">
          <SectionTitle>Copies you’ve read</SectionTitle>
          {copies
            .filter((c) => c.ackAt)
            .map((c) => (
              <CopyCard key={c.id} rec={c} coachName={coach?.name ?? "Your coach"} busy={false} onAck={() => undefined} collapsed />
            ))}
        </section>
      )}

      <section>
        <AssessmentHub clientId={user.id} clientName={user.name} role="CLIENT" minor={isMinor} onChanged={reload} onDetail={setDetail} />
      </section>

      {filling && (
        <Modal open wide onClose={() => setFilling(null)} title={FORM_LABEL[filling]}>
          <FormFill
            key={filling}
            kind={filling}
            minor={isMinor}
            clientName={user.name}
            initial={state?.current[filling]?.data as FormData[FormKind] | undefined}
            onCancel={() => setFilling(null)}
            onSubmit={async (data) => {
              const r = await api("/api/intake", { body: { kind: filling, data } });
              if (!r.ok) return r.error ?? "Couldn't save that.";
              setFilling(null);
              reload();
              return null;
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function CopyCard({ rec, coachName, busy, onAck, collapsed }: { rec: FormRec; coachName: string; busy: boolean; onAck: () => void; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <Card className="p-4">
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {FORM_LABEL[rec.kind]} · version {rec.version}
          </div>
          <div className="text-xs text-muted">
            {coachName} gave you this copy on {when(rec.sharedAt)}
            {rec.ackAt ? ` · you acknowledged it ${when(rec.ackAt)}` : ""}
          </div>
        </div>
      </button>
      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          {rec.reviewNote && (
            <Notice tone="info">
              <span className="font-semibold">Note from {coachName}: </span>
              {rec.reviewNote}
            </Notice>
          )}
          <FormView kind={rec.kind} data={rec.data} />
          {!rec.ackAt && (
            <Button onClick={onAck} disabled={busy}>
              <Check size={16} /> I have read this
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
