"use client";

import { format, parseISO } from "date-fns";
import { Check, Circle, ClipboardCheck, Gift, LoaderCircle, Send, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AssessmentHub } from "@/components/assessment/AssessmentHub";
import { FormView } from "@/components/intake/FormParts";
import { FormPreviewModal, FormsPreviewRows } from "@/components/intake/FormsPreview";
import { Badge, Button, Card, Field, Notice, SectionTitle, Select, Textarea } from "@/components/ui";
import { FORM_BLURB, FORM_KINDS, FORM_LABEL, PRIVACY_NOTE_COACH, type FormKind } from "@/lib/intakeForms";
import type { AssessmentRec, FormRec, IntakeStateRec } from "@/lib/intakeApi";
import { api, refreshAccounts } from "@/lib/store";
import { cn } from "@/lib/utils";

/*
 * The "Intake" tab on a client's page: what to do before the first session (a checklist), the forms the client filled in with every
 * version kept, giving the client a copy to acknowledge, and the posture and fitness assessments.
 */

const when = (iso: string | null | undefined) => {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
};

export function CoachIntake({ clientId, clientName, minor }: { clientId: string; clientName: string; minor: boolean }) {
  const [state, setState] = useState<IntakeStateRec | null>(null);
  const [assess, setAssess] = useState<AssessmentRec[] | null>(null);
  const [rev, setRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(false);
  const [detail, setDetail] = useState(false);
  const [preview, setPreview] = useState<FormKind | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [a, b] = await Promise.all([api<{ intake: IntakeStateRec }>(`/api/intake?clientId=${encodeURIComponent(clientId)}`), api<{ assessments: AssessmentRec[] }>(`/api/assessments?clientId=${encodeURIComponent(clientId)}`)]);
      if (!live) return;
      if (!a.ok || !a.data) return setError(a.error ?? "Couldn't load the forms.");
      setError(null);
      setState(a.data.intake);
      setAssess(b.data?.assessments ?? []);
    })();
    return () => {
      live = false;
    };
  }, [clientId, rev]);

  const reload = () => {
    setRev((n) => n + 1);
    void refreshAccounts();
  };

  const ask = async () => {
    setAsking(true);
    setError(null);
    const r = await api("/api/intake", { body: { clientId } });
    setAsking(false);
    if (!r.ok) return setError(r.error ?? "Couldn't send the request.");
    setAsked(true);
    reload();
  };

  const checklist = useMemo(() => {
    if (!state) return [];
    const cur = state.current;
    const parq = cur.PARQ;
    const flagged = parq && parq.flags > 0;
    const coachDone = (assess ?? []).filter((a) => a.filledBy === "COACH" && a.status === "DONE");
    return [
      { ok: !!state.request, label: "Forms requested", hint: state.request ? `Asked on ${when(state.request.createdAt)}` : "Ask the client to fill them in before you meet" },
      { ok: !!parq, label: "Health questionnaire filled in", hint: parq ? `Version ${parq.version}, ${when(parq.submittedAt)}` : "" },
      { ok: !!parq && (!flagged || !!parq.reviewedAt), label: flagged ? "Health answers reviewed (there are yes answers)" : "Health answers reviewed", hint: flagged && !parq?.reviewedAt ? "Read them and give the client a copy" : "", warn: !!flagged && !parq?.reviewedAt },
      { ok: !!cur.DECLARATION, label: "Health declaration signed", hint: cur.DECLARATION ? `Signed ${when(cur.DECLARATION.submittedAt)}` : "" },
      { ok: !!cur.GOALS, label: "Goals and lifestyle filled in", hint: "" },
      { ok: coachDone.length > 0, label: "Posture and fitness assessment done", hint: coachDone.length ? `Last: ${when(coachDone[0].takenAt)}` : "Do it at the first session" },
      { ok: coachDone.some((a) => !!a.ackAt), label: "Client has acknowledged their copy", hint: coachDone.some((a) => a.sharedAt && !a.ackAt) ? "Copy given, waiting for them" : coachDone.length ? "Give them a copy of the assessment" : "" },
    ];
  }, [state, assess]);

  if (!state) {
    return error ? <Notice tone="error">{error}</Notice> : (
      <div className="flex items-center gap-2 p-6 text-sm text-muted">
        <LoaderCircle size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  const missing = state.request ? state.request.kinds.filter((k) => !state.current[k]) : [];

  return (
    <div className="space-y-8">
      {!detail && (
      <>
      <section>
        <SectionTitle
          action={
            <Button size="sm" onClick={() => void ask()} disabled={asking}>
              {asking ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />} {state.request ? "Ask again" : "Send the forms"}
            </Button>
          }
        >
          Before the first session
        </SectionTitle>
        <Card className="space-y-1 p-4">
          {checklist.map((c) => (
            <div key={c.label} className="flex items-start gap-3 py-1.5">
              {c.ok ? <Check size={18} className="mt-0.5 shrink-0 text-success" /> : c.warn ? <ShieldAlert size={18} className="mt-0.5 shrink-0 text-danger" /> : <Circle size={18} className="mt-0.5 shrink-0 text-muted" />}
              <div className="min-w-0">
                <div className={cn("text-sm font-medium", !c.ok && "text-muted", c.warn && "text-danger")}>{c.label}</div>
                {c.hint && <div className="text-xs text-muted">{c.hint}</div>}
              </div>
            </div>
          ))}
        </Card>
        {asked && <p className="mt-2 text-sm text-success">{clientName.split(" ")[0]} was sent a message asking them to fill in the forms. They sign in to their own account to do it. You’ll be told as they finish, and reminded if they haven’t done them 24 hours before a session.</p>}
        {state.request && missing.length > 0 && <p className="mt-2 text-sm text-muted">Still to do: {missing.map((k) => FORM_LABEL[k].toLowerCase()).join(", ")}.</p>}
        {minor && <p className="mt-2 text-sm text-muted">{clientName.split(" ")[0]} is under 18, so the declaration needs a parent or guardian’s name.</p>}
        <details className="mt-3 rounded-xl border border-line p-3 text-sm">
          <summary className="cursor-pointer font-semibold">See the forms {clientName.split(" ")[0]} gets</summary>
          <div className="mt-3">
            <FormsPreviewRows onPreview={setPreview} />
          </div>
        </details>
      </section>

      <section>
        <SectionTitle>Forms</SectionTitle>
        <p className="mb-3 text-xs text-muted">{PRIVACY_NOTE_COACH}</p>
        <div className="space-y-3">
          {FORM_KINDS.map((k) => (
            <FormCard key={k} kind={k} history={state.history.filter((h) => h.kind === k)} clientName={clientName} onChanged={reload} />
          ))}
        </div>
      </section>

      </>
      )}

      <section>
        <AssessmentHub clientId={clientId} clientName={clientName} role="COACH" minor={minor} onChanged={reload} onDetail={setDetail} />
      </section>
      <FormPreviewModal kind={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function FormCard({ kind, history, clientName, onChanged }: { kind: FormKind; history: FormRec[]; clientName: string; onChanged: () => void }) {
  const [sel, setSel] = useState<string>("");
  const rec = history.find((h) => h.id === sel) ?? history[0] ?? null;
  const [open, setOpen] = useState(() => (history[0]?.flags ?? 0) > 0 && !history[0]?.reviewedAt);
  const [note, setNote] = useState("");
  const [noteFor, setNoteFor] = useState("");
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start each version with the note the coach already wrote on it.
  if (rec && noteFor !== rec.id) {
    setNoteFor(rec.id);
    setNote(rec.reviewNote);
  }

  const review = async () => {
    if (!rec) return;
    setBusy(true);
    setError(null);
    const r = await api(`/api/intake/${rec.id}`, { method: "PATCH", body: { note, share } });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Couldn't save that.");
    onChanged();
  };

  return (
    <Card className="p-4">
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ClipboardCheck size={20} className={cn("mt-0.5 shrink-0", rec ? "text-success" : "text-muted")} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{FORM_LABEL[kind]}</div>
          <div className="text-xs text-muted">{rec ? `Version ${rec.version} · ${when(rec.submittedAt)}` : FORM_BLURB[kind]}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {!rec && <Badge>Not filled in yet</Badge>}
            {rec && rec.flags > 0 && <Badge className="border-danger/30 bg-danger/15 text-danger">{rec.flags} yes {rec.flags === 1 ? "answer" : "answers"}</Badge>}
            {rec && !rec.reviewedAt && <Badge className="border-pr/30 bg-pr/15 text-pr">Not reviewed</Badge>}
            {rec?.sharedAt && !rec.ackAt && <Badge className="border-accent/30 bg-accent/15 text-accent">Copy given</Badge>}
            {rec?.ackAt && <Badge className="border-success/30 bg-success/15 text-success">Acknowledged {when(rec.ackAt)}</Badge>}
          </div>
        </div>
      </button>
      {open && rec && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          {history.length > 1 && (
            <Field label="Version">
              <Select value={rec.id} onChange={(e) => setSel(e.target.value)}>
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    Version {h.version} · {when(h.submittedAt)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <FormView kind={kind} data={rec.data} />
          <div className="space-y-3 rounded-xl border border-line bg-field/40 p-3">
            <div className="text-sm font-semibold">Review{rec.reviewedAt ? ` (done ${when(rec.reviewedAt)})` : ""}</div>
            <Field label={`A note for ${clientName.split(" ")[0]} (optional)`} hint="They see this with their copy.">
              <Textarea value={note} maxLength={800} onChange={(e) => setNote(e.target.value)} placeholder="For example: thanks, I'll keep the squat depth gentle for your knee." />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-accent" checked={share} onChange={(e) => setShare(e.target.checked)} />
              <span>Give {clientName.split(" ")[0]} a copy to read and acknowledge, so they can see exactly what was recorded.</span>
            </label>
            {error && <Notice tone="error">{error}</Notice>}
            <Button size="sm" onClick={() => void review()} disabled={busy}>
              {share ? <Gift size={14} /> : <Check size={14} />} {share ? (rec.sharedAt ? "Update and give the copy again" : "Mark reviewed and give a copy") : "Mark reviewed"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
