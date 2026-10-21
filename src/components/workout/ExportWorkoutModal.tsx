"use client";

import { format, parseISO } from "date-fns";
import { Check, Copy, Download, FileText, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Field, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { gymLabel } from "@/lib/gyms";
import { useViewer } from "@/lib/hooks";
import { doneWorkouts } from "@/lib/stats";
import { cn, downloadText } from "@/lib/utils";
import { blocksToText, templateBlock, workoutBlock, type ExportBlock, type ExportDoc } from "@/lib/workoutExport";
import { buildPdf, downloadBlob, fileSafe } from "@/lib/workoutPdf";

type Scope = "SINGLE" | "HISTORY" | "BULK";
type Kind = "ROUTINE" | "WORKOUT";
type Fmt = "PDF" | "TEXT";

export interface ExportPreset {
  scope?: Scope;
  kind?: Kind;
  templateId?: string;
  clientId?: string;
}

export function ExportWorkoutModal({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: ExportPreset }) {
  return open ? <ExportFlow onClose={onClose} preset={preset ?? {}} /> : null;
}

function ExportFlow({ onClose, preset }: { onClose: () => void; preset: ExportPreset }) {
  const { db, user, unit, exMap, clients } = useViewer();
  const mine = useMemo(() => db.templates.filter((t) => t.ownerId === user?.id && !t.starter).sort((a, b) => a.name.localeCompare(b.name)), [db.templates, user?.id]);
  const allTemplates = useMemo(() => [...db.templates].sort((a, b) => a.name.localeCompare(b.name)), [db.templates]);
  const people = clients.filter((c) => !c.profile.archived || db.workouts.some((w) => w.clientId === c.user.id));

  const [scope, setScope] = useState<Scope>(preset.scope ?? "SINGLE");
  const [kind, setKind] = useState<Kind>(preset.kind ?? (preset.templateId || !preset.clientId ? "ROUTINE" : "WORKOUT"));
  const [templateId, setTemplateId] = useState(preset.templateId ?? allTemplates[0]?.id ?? "");
  const [clientId, setClientId] = useState(preset.clientId ?? people[0]?.user.id ?? "");
  const [workoutId, setWorkoutId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fmt, setFmt] = useState<Fmt>("PDF");
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const clientWorkouts = useMemo(() => doneWorkouts(db.workouts, clientId).reverse(), [db.workouts, clientId]);
  const pickedWorkoutId = clientWorkouts.some((w) => w.id === workoutId) ? workoutId : (clientWorkouts[0]?.id ?? "");
  const clientName = (id: string) => db.users.find((u) => u.id === id)?.name ?? "Client";
  const coachName = user?.name ?? "";
  const brand = db.settings.brandName || "CoachFlow";

  const doc: ExportDoc | null = useMemo(() => {
    const blocks: ExportBlock[] = [];
    let title = "";
    let subtitle = "";
    const stamp = format(new Date(), "d MMM yyyy");
    const wb = (id: string) => {
      const w = db.workouts.find((x) => x.id === id);
      return w ? workoutBlock(w, exMap, unit, { clientName: clientName(w.clientId), location: w.gymId ? gymLabel(w.gymId, db.gyms) : undefined }) : null;
    };
    if (scope === "SINGLE") {
      if (kind === "ROUTINE") {
        const t = db.templates.find((x) => x.id === templateId);
        if (!t) return null;
        blocks.push(templateBlock(t, exMap, unit));
        title = "Routine plan";
        subtitle = `Prepared by ${coachName} | ${stamp}`;
      } else {
        const b = pickedWorkoutId ? wb(pickedWorkoutId) : null;
        if (!b) return null;
        blocks.push(b);
        title = "Workout log";
        subtitle = `${clientName(clientId)} | ${stamp}`;
      }
    } else if (scope === "HISTORY") {
      const list = doneWorkouts(db.workouts, clientId).filter((w) => {
        const day = format(parseISO(w.startedAt), "yyyy-MM-dd");
        return (!from || day >= from) && (!to || day <= to);
      });
      for (const w of list) {
        const b = wb(w.id);
        if (b) blocks.push(b);
      }
      title = "Workout history";
      const range = from || to ? `${from ? format(parseISO(from), "d MMM yyyy") : "start"} - ${to ? format(parseISO(to), "d MMM yyyy") : "today"}` : "All workouts";
      subtitle = `${clientName(clientId)} | ${range}`;
    } else {
      for (const t of mine) blocks.push(templateBlock(t, exMap, unit));
      title = "Routine library";
      subtitle = `${coachName} | ${mine.length} routine${mine.length === 1 ? "" : "s"} | ${stamp}`;
    }
    if (blocks.length === 0) return null;
    return { brand, title, subtitle, blocks };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, kind, templateId, clientId, pickedWorkoutId, from, to, db.workouts, db.templates, db.gyms, db.users, exMap, unit, mine, brand, coachName]);

  const text = useMemo(() => (doc && fmt === "TEXT" ? blocksToText(doc) : ""), [doc, fmt]);
  const baseName = doc ? fileSafe(`${brand}-${doc.title}-${scope === "SINGLE" ? doc.blocks[0].title : scope === "HISTORY" ? clientName(clientId) : "all"}`) : "workout";

  const makeBlob = async () => {
    if (!doc) throw new Error("Nothing to export.");
    return buildPdf(doc);
  };

  const download = async () => {
    setBusy("download");
    setError(null);
    try {
      downloadBlob(await makeBlob(), `${baseName}.pdf`);
    } catch {
      setError("Could not create the PDF. Please try again.");
    }
    setBusy(null);
  };

  const share = async () => {
    setBusy("share");
    setError(null);
    try {
      const file = new File([await makeBlob()], `${baseName}.pdf`, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: doc?.title });
      else downloadBlob(file, file.name);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError("Could not share the PDF. Try Download instead.");
    }
    setBusy(null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Your browser blocked copying. Select the text and copy it manually.");
    }
  };

  const total = doc?.blocks.length ?? 0;
  const rowsTotal = doc?.blocks.reduce((n, b) => n + b.rows.length, 0) ?? 0;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const scopes: [Scope, string, string][] = [
    ["SINGLE", "One workout / routine", "A single plan or session"],
    ["HISTORY", "Client history", "A client's logged workouts"],
    ["BULK", "All my routines", "Every routine you created"],
  ];

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Export workouts"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="mr-auto">
            Close
          </Button>
          {fmt === "PDF" ? (
            <>
              {canShare && (
                <Button variant="secondary" disabled={!doc || !!busy} onClick={() => void share()}>
                  <Share2 size={16} /> {busy === "share" ? "Preparing…" : "Share"}
                </Button>
              )}
              <Button disabled={!doc || !!busy} onClick={() => void download()}>
                <Download size={16} /> {busy === "download" ? "Creating PDF…" : "Download PDF"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={!doc} onClick={() => downloadText(text, `${baseName}.txt`)}>
                <Download size={16} /> Download .txt
              </Button>
              <Button disabled={!doc} onClick={() => void copy()}>
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy to clipboard"}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">What to export</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {scopes.map(([v, t, h]) => (
              <button key={v} type="button" onClick={() => setScope(v)} className={cn("rounded-xl border p-3 text-left transition-colors", scope === v ? "border-accent bg-accent/10" : "border-line bg-field hover:border-accent/40")}>
                <div className="text-sm font-semibold">{t}</div>
                <div className="mt-0.5 text-xs text-muted">{h}</div>
              </button>
            ))}
          </div>
        </div>

        {scope === "SINGLE" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["ROUTINE", "Routine template"],
                  ["WORKOUT", "Logged workout"],
                ] as [Kind, string][]
              ).map(([v, t]) => (
                <button key={v} type="button" onClick={() => setKind(v)} className={cn("min-h-11 rounded-xl border px-3 text-sm font-semibold", kind === v ? "border-accent bg-accent/10 text-accent" : "border-line bg-field text-muted")}>
                  {t}
                </button>
              ))}
            </div>
            {kind === "ROUTINE" ? (
              <Field label="Routine" error={allTemplates.length === 0 ? "You have no routines yet." : null}>
                <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {allTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Client">
                  <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    {people.map((c) => (
                      <option key={c.user.id} value={c.user.id}>
                        {c.user.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Workout" error={clientWorkouts.length === 0 ? "No logged workouts for this client." : null}>
                  <Select value={pickedWorkoutId} onChange={(e) => setWorkoutId(e.target.value)}>
                    {clientWorkouts.map((w) => (
                      <option key={w.id} value={w.id}>
                        {format(parseISO(w.startedAt), "d MMM yyyy")} · {w.title}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}

        {scope === "HISTORY" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Client">
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                {people.map((c) => (
                  <option key={c.user.id} value={c.user.id}>
                    {c.user.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From (optional)">
              <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To (optional)">
              <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        )}

        {scope === "BULK" && (
          <p className="text-sm text-muted">
            {mine.length === 0 ? "You haven't created any routines yet." : `${mine.length} routine${mine.length === 1 ? "" : "s"} you created will be exported (the built-in starter routines are not included).`}
          </p>
        )}

        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Format</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setFmt("PDF")} className={cn("rounded-xl border p-3 text-left transition-colors", fmt === "PDF" ? "border-accent bg-accent/10" : "border-line bg-field hover:border-accent/40")}>
              <div className="flex flex-wrap items-center gap-2">
                <FileText size={16} className="text-accent" />
                <span className="text-sm font-semibold">Formatted PDF</span>
                <Badge className="border-success/30 bg-success/15 text-success">Recommended</Badge>
              </div>
              <div className="mt-1 text-xs text-muted">Formatted for easy reading — share it or print it for the gym floor.</div>
            </button>
            <button type="button" onClick={() => setFmt("TEXT")} className={cn("rounded-xl border p-3 text-left transition-colors", fmt === "TEXT" ? "border-accent bg-accent/10" : "border-line bg-field hover:border-accent/40")}>
              <div className="flex items-center gap-2">
                <Copy size={16} className="text-muted" />
                <span className="text-sm font-semibold">Plain text</span>
              </div>
              <div className="mt-1 text-xs text-muted">Copy into WhatsApp or Notepad, or save as .txt. Can be imported back.</div>
            </button>
          </div>
        </div>

        {!doc ? (
          <Notice tone="warn">Nothing to export with these choices yet.</Notice>
        ) : fmt === "PDF" ? (
          <p className="text-sm text-muted">
            The PDF will contain {total} {scope === "BULK" ? "routine" : "workout"}
            {total === 1 ? "" : "s"} ({rowsTotal} exercise{rowsTotal === 1 ? "" : "s"}) with the {brand} header and logo.
          </p>
        ) : (
          <Field label="Preview">
            <Textarea readOnly value={text} rows={10} className="font-mono text-[13px] leading-relaxed" onFocus={(e) => e.currentTarget.select()} />
          </Field>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
