"use client";

import { format } from "date-fns";
import { Check, ClipboardPaste, FileUp, LoaderCircle, Plus, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ExercisePicker } from "@/components/ExerciseLibrary";
import { Badge, Button, Field, IconButton, Input, Modal, Notice, Select, Textarea, Toggle } from "@/components/ui";
import { EQUIPMENT, MEASURE_LABELS, MUSCLES } from "@/data/exercises";
import { buildIndex, isKnownName, type ExerciseGuess } from "@/lib/exerciseMatch";
import { useViewer } from "@/lib/hooks";
import { buildDrafts, draftsToTemplates, draftsToWorkouts, guessFor, isResolved, type DraftExercise, type DraftSet, type DraftWorkout, type ResolvedExercise } from "@/lib/importDraft";
import { addExercise, logCompletedWorkouts, notifyRoutineImport, saveTemplate } from "@/lib/store";
import type { Equipment, Exercise, MeasureType, MuscleGroup } from "@/lib/types";
import { cn, weightUnit } from "@/lib/utils";
import { parseWorkoutText, type ParsedWorkout } from "@/lib/workoutText";

const EXAMPLE = `# Push Day A - 12 Oct 2026
Barbell Bench Press - 4 x 8 @ 80kg
Incline Dumbbell Press: 3 sets x 10-12 reps (24kg)
Lateral Raise 3x15
Treadmill Incline Walk - 20 mins

# Pull Day B
Lat Pulldown 3x12
Barbell Row 60x10, 70x8, 80x6`;

type Dest = "TEMPLATE" | "HISTORY";

export function ImportWorkoutModal({ open, onClose, defaultClientId }: { open: boolean; onClose: () => void; defaultClientId?: string }) {
  return open ? <ImportFlow onClose={onClose} defaultClientId={defaultClientId} /> : null;
}

function ImportFlow({ onClose, defaultClientId }: { onClose: () => void; defaultClientId?: string }) {
  const { db, user, unit, exMap, clients } = useViewer();
  const [step, setStep] = useState<"input" | "preview" | "done">("input");
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<DraftWorkout[]>([]);
  // A client imports for themself: log it as a finished workout, or keep it as a routine of their own.
  const isClient = user?.role === "CLIENT";
  const [dest, setDest] = useState<Dest>(isClient ? "HISTORY" : "TEMPLATE");
  const active = clients.filter((c) => !c.profile.archived);
  const [clientId, setClientId] = useState(defaultClientId ?? (isClient ? (user?.id ?? "") : (active[0]?.user.id ?? "")));
  const [defaultDate, setDefaultDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [share, setShare] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ dest: Dest; count: number; created: number } | null>(null);
  const [pickFor, setPickFor] = useState<{ w: string; e: string } | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [readInfo, setReadInfo] = useState<{ via: "ai" | "basic"; why?: string } | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => buildIndex(db.exercises), [db.exercises]);
  const all = drafts.flatMap((w) => w.exercises);
  const unresolved = all.filter((d) => !isResolved(d));
  const unit_ = weightUnit(unit);

  const preview = async () => {
    setError(null);
    setAiBusy(true);
    const today = format(new Date(), "yyyy-MM-dd");
    let parsed: ParsedWorkout[] | null = null;
    let why = "";
    // 1) AI reader: understands shorthand, supersets, warm-up/drop sets, rest times and maps to the exercise library.
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 58_000);
      const res = await fetch("/api/import/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, unit, today }),
        credentials: "same-origin",
        signal: ctl.signal,
      });
      clearTimeout(timer);
      const data = (await res.json().catch(() => null)) as { workouts?: ParsedWorkout[]; error?: string } | null;
      if (res.ok && Array.isArray(data?.workouts) && data.workouts.length) parsed = data.workouts;
      else why = data?.error ?? "The AI couldn't read that.";
    } catch {
      why = "Couldn't reach the AI (offline or too slow).";
    }
    // 2) Fallback: the built-in reader works instantly and offline.
    const via: "ai" | "basic" = parsed ? "ai" : "basic";
    if (!parsed) parsed = parseWorkoutText(text, { unit, today: new Date(), isKnown: (n) => isKnownName(n, index) });
    setAiBusy(false);
    if (parsed.length === 0) {
      setError("I couldn't find any exercises in that text. Try one exercise per line, like “Lat Pulldown 3x12”.");
      return;
    }
    setReadInfo({ via, why: why || undefined });
    setDrafts(buildDrafts(parsed, index, unit));
    setStep("preview");
  };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setFileNote(null);
    const isImage = f.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif)$/i.test(f.name);
    if (f.size > (isImage ? 25 : 4) * 1024 * 1024) {
      setError(isImage ? "That photo is too large." : "That file is too large (4 MB max).");
      return;
    }
    // Plain text is read right here; everything else (PDF, Word, Excel, CSV, RTF, HTML…) is read by the server.
    if (/\.(txt|text|md|markdown|log)$/i.test(f.name) || (f.type === "text/plain" && !f.name.includes("."))) {
      setText(await f.text());
      setFileNote(`Loaded ${f.name}. Check the text below, then read the plan.`);
      return;
    }
    setReading(f.name);
    try {
      // Photos are shrunk in the browser first (smaller upload, and it converts iPhone formats to JPEG).
      let body: Blob = f;
      let sendName = f.name;
      if (isImage) {
        try {
          body = await shrinkImage(f);
          sendName = f.name.replace(/\.[^.]+$/, "") + ".jpg";
        } catch {
          setError("I couldn't open that picture. Try a JPG or PNG screenshot.");
          setReading(null);
          return;
        }
      }
      const res = await fetch(`/api/import/extract?brand=${encodeURIComponent(db.settings.brandName || "CoachFlow")}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(sendName) },
        body,
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => null)) as { text?: string; kind?: string; pages?: number; error?: string } | null;
      if (!res.ok || !data?.text) setError(data?.error ?? "I couldn't read that file. Try another format or paste the text.");
      else {
        setText(data.text);
        setFileNote(`Read ${f.name} (${data.kind}${data.pages ? `, ${data.pages} page${data.pages === 1 ? "" : "s"}` : ""}). Check the text below, then read the plan.`);
      }
    } catch {
      setError("Couldn't reach the server to read that file. Check your connection and try again.");
    }
    setReading(null);
  };

  const patchW = (wk: string, p: Partial<DraftWorkout>) => setDrafts((l) => l.map((w) => (w.key === wk ? { ...w, ...p } : w)));
  const patchE = (wk: string, ek: string, p: Partial<DraftExercise>) =>
    setDrafts((l) => l.map((w) => (w.key === wk ? { ...w, exercises: w.exercises.map((e) => (e.key === ek ? { ...e, ...p } : e)) } : w)));
  const removeE = (wk: string, ek: string) =>
    setDrafts((l) => l.map((w) => (w.key === wk ? { ...w, exercises: w.exercises.filter((e) => e.key !== ek) } : w)).filter((w) => w.exercises.length > 0));

  const createAllUnmatched = () =>
    setDrafts((l) => l.map((w) => ({ ...w, exercises: w.exercises.map((e) => (isResolved(e) ? e : { ...e, create: guessFor(e) })) })));

  const save = () => {
    if (!user) return;
    const made = new Map<string, Exercise>();
    const resolve = (d: DraftExercise): ResolvedExercise => {
      if (d.exerciseId) return { exerciseId: d.exerciseId, type: exMap.get(d.exerciseId)?.type };
      const c = d.create as ExerciseGuess;
      const k = c.name.trim().toLowerCase();
      let ex = made.get(k);
      if (!ex) {
        ex = addExercise({ name: c.name.trim(), primary: c.primary, secondary: [], equipment: c.equipment, type: c.type });
        made.set(k, ex);
      }
      return { exerciseId: ex.id, type: ex.type };
    };
    if (dest === "TEMPLATE") {
      const list = draftsToTemplates(drafts, resolve, unit, user.id, share && user.role === "TRAINER");
      list.forEach(saveTemplate);
      if (isClient && list.length) notifyRoutineImport(list.map((t) => t.name), list.reduce((n, t) => n + t.exercises.length, 0));
      setResult({ dest, count: list.length, created: made.size });
    } else {
      const list = draftsToWorkouts(drafts, resolve, unit, clientId, defaultDate);
      logCompletedWorkouts(list);
      setResult({ dest, count: list.length, created: made.size });
    }
    setStep("done");
  };

  const canSave = unresolved.length === 0 && drafts.length > 0 && (dest === "TEMPLATE" || (!!clientId && !!defaultDate));
  const clientName = clients.find((c) => c.user.id === clientId)?.user.name;

  return (
    <>
      <Modal
        open
        wide
        onClose={onClose}
        title={step === "input" ? "Import workout" : step === "preview" ? "Check before saving" : "Imported"}
        footer={
          step === "input" ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!text.trim() || aiBusy || !!reading} onClick={() => void preview()}>
                {aiBusy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />} {aiBusy ? "Reading with AI…" : "Read my plan"}
              </Button>
            </>
          ) : step === "preview" ? (
            <>
              <Button variant="secondary" onClick={() => setStep("input")} className="mr-auto">
                Back
              </Button>
              <Button disabled={!canSave} onClick={save}>
                <Check size={16} /> {dest === "TEMPLATE" ? `Save ${drafts.length} routine${drafts.length === 1 ? "" : "s"}` : `Log ${drafts.length} workout${drafts.length === 1 ? "" : "s"}`}
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Done</Button>
          )
        }
      >
        {step === "input" && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Paste a plan from Notepad, Notes or WhatsApp, or upload a file or photo. AI reads even messy shorthand like “DB Incline 4x8-10 @ 30kg”. Separate several workouts with headings like <span className="font-mono text-xs">#&nbsp;Push Day A</span>. If you write a date (e.g. <span className="font-mono text-xs">12 Oct 2026</span> or <span className="font-mono text-xs">12/10/2026</span>) it is used as the workout date.
            </p>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void readFile(e.dataTransfer.files?.[0]);
              }}
              rows={11}
              placeholder={EXAMPLE}
              className={cn("font-mono text-[13px] leading-relaxed", dragging && "border-accent ring-2 ring-accent/40")}
              spellCheck={false}
              autoFocus
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  void readFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" size="sm" disabled={!!reading} onClick={() => fileRef.current?.click()}>
                {reading ? <LoaderCircle size={14} className="animate-spin" /> : <FileUp size={14} />} {reading ? `Reading ${reading}…` : "Upload a file"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setText(EXAMPLE)}>
                <ClipboardPaste size={14} /> Try an example
              </Button>
            </div>
            <div className="rounded-xl border border-line p-3 text-xs text-muted">
              <div className="mb-1 font-semibold text-ink">Understood formats</div>
              <ul className="list-inside list-disc space-y-0.5">
                <li>Barbell Bench Press - 4 x 8 @ 80kg</li>
                <li>Incline Dumbbell Press: 3 sets x 10-12 reps (24kg)</li>
                <li>Lat Pulldown 3x12 &nbsp;·&nbsp; Squat 60x10, 70x8, 80x6</li>
                <li>Treadmill Incline Walk - 20 mins &nbsp;·&nbsp; Plank 3 x 45s</li>
              </ul>
            </div>
            <p className="text-xs text-muted">Files: PDF (including scans), photos and screenshots, Word (.docx), Excel (.xlsx), CSV, text, Markdown, RTF and HTML — or drop one onto the box above.</p>
            {fileNote && <Notice tone="success">{fileNote}</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-5">
            {readInfo?.via === "ai" ? (
              <Notice tone="success">Read with AI. Please check the details below before saving.</Notice>
            ) : (
              readInfo && <Notice tone="info">The basic reader was used{readInfo.why ? ` (${readInfo.why.replace(/[.]$/, "")})` : ""}. Please check the details below.</Notice>
            )}
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Save to</div>
              <div className="grid grid-cols-2 gap-2">
                {(isClient
                  ? ([
                      ["HISTORY", "Log directly", "Add it to your workout history as completed"],
                      ["TEMPLATE", "Save as a routine", "Keep it to start and log any time in one tap"],
                    ] as [Dest, string, string][])
                  : ([
                      ["TEMPLATE", "Routine templates", "Reusable plans you can start for any client"],
                      ["HISTORY", "A client's history", "Log them as completed workouts"],
                    ] as [Dest, string, string][])
                ).map(([v, title, hint]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setDest(v)}
                    className={cn("rounded-xl border p-3 text-left transition-colors", dest === v ? "border-accent bg-accent/10" : "border-line bg-field hover:border-accent/40")}
                  >
                    <div className="text-sm font-semibold">{title}</div>
                    <div className="mt-0.5 text-xs text-muted">{hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {dest === "HISTORY" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {!isClient && (
                  <Field label="Client" error={!clientId ? "Add a client first." : null}>
                    <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                      {active.map((c) => (
                        <option key={c.user.id} value={c.user.id}>
                          {c.user.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Date for workouts without one" hint="Dates written in your text always win.">
                  <Input type="date" value={defaultDate} onChange={(e) => setDefaultDate(e.target.value)} />
                </Field>
              </div>
            ) : (
              user?.role === "TRAINER" && <Toggle checked={share} onChange={setShare} label="Share with all my clients" />
            )}

            {unresolved.length > 0 && (
              <Notice
                tone="warn"
                action={
                  <Button size="sm" variant="secondary" onClick={createAllUnmatched}>
                    <Plus size={14} /> Create all as custom
                  </Button>
                }
              >
                {unresolved.length} exercise{unresolved.length === 1 ? "" : "s"} not in the library yet — map {unresolved.length === 1 ? "it" : "them"} to an existing exercise or create {unresolved.length === 1 ? "it" : "them"} as custom.
              </Notice>
            )}

            <div className="space-y-4">
              {drafts.map((w) => (
                <div key={w.key} className="rounded-2xl border border-line">
                  <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_auto]">
                    <Input value={w.title} onChange={(e) => patchW(w.key, { title: e.target.value })} placeholder="Workout name" aria-label="Workout name" className="font-semibold" />
                    {dest === "HISTORY" && (
                      <div className="flex flex-col items-start gap-1 sm:items-end">
                        <Input type="date" value={w.date} onChange={(e) => patchW(w.key, { date: e.target.value })} aria-label="Workout date" className="w-44" />
                        {w.detected && w.date ? <Badge className="whitespace-nowrap border-success/30 bg-success/15 text-success">Date from your text</Badge> : !w.date ? <Badge className="whitespace-nowrap">Uses the default date</Badge> : null}
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 p-3">
                    {w.exercises.map((d) => (
                      <ExerciseDraft
                        key={d.key}
                        d={d}
                        exMap={exMap}
                        unit={unit_}
                        onChange={(p) => patchE(w.key, d.key, p)}
                        onRemove={() => removeE(w.key, d.key)}
                        onSearch={() => setPickFor({ w: w.key, e: d.key })}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {dest === "HISTORY" && clientName && !isClient && <p className="text-xs text-muted">These will be logged as completed workouts for {clientName}.</p>}
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
              <Check size={28} />
            </div>
            <div>
              <div className="text-lg font-bold">
                {result.dest === "TEMPLATE" ? `${result.count} routine${result.count === 1 ? "" : "s"} saved` : `${result.count} workout${result.count === 1 ? "" : "s"} logged${clientName && !isClient ? ` for ${clientName}` : ""}`}
              </div>
              {result.created > 0 && <p className="mt-1 text-sm text-muted">{result.created} new custom exercise{result.created === 1 ? "" : "s"} added to your library.</p>}
              <p className="mt-1 text-sm text-muted">{result.dest === "TEMPLATE" ? (isClient ? "Find them under Routine templates: tap Start to log one any time. They are private to you." : "Find them under Routine templates.") : isClient ? "They appear in your workout history, and your coach has been told." : "They appear in the client's workout history."}</p>
            </div>
            {result.dest === "HISTORY" && clientId && !isClient && (
              <Link href={`/clients/${clientId}`} className="inline-block text-sm font-semibold text-accent">
                Open client →
              </Link>
            )}
          </div>
        )}
      </Modal>

      <ExercisePicker
        open={!!pickFor}
        onClose={() => setPickFor(null)}
        confirmLabel="Use"
        onConfirm={(ids) => {
          if (pickFor && ids[0]) patchE(pickFor.w, pickFor.e, { exerciseId: ids[0], create: null, status: "chosen" });
          setPickFor(null);
        }}
      />
    </>
  );
}

/** Scales a photo down to at most 1800px and re-encodes it as JPEG. */
async function shrinkImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85));
}

/* ---------------- One exercise in the preview ---------------- */
function ExerciseDraft({
  d,
  exMap,
  unit,
  onChange,
  onRemove,
  onSearch,
}: {
  d: DraftExercise;
  exMap: Map<string, Exercise>;
  unit: string;
  onChange: (p: Partial<DraftExercise>) => void;
  onRemove: () => void;
  onSearch: () => void;
}) {
  const chosen = d.exerciseId ? exMap.get(d.exerciseId) : undefined;
  const type: MeasureType | undefined = chosen?.type ?? d.create?.type;
  const timed = type ? type === "DURATION_DISTANCE" || type === "DURATION_ONLY" : d.timedHint;
  const resolved = isResolved(d);

  const badge = d.create ? (
    <Badge className="border-accent/30 bg-accent/15 text-accent">New custom</Badge>
  ) : !resolved ? (
    <Badge className="border-danger/30 bg-danger/15 text-danger">No match</Badge>
  ) : d.status === "matched" || d.status === "chosen" ? (
    <Badge className="border-success/30 bg-success/15 text-success">{d.status === "chosen" ? "Chosen" : "Matched"}</Badge>
  ) : (
    <Badge className="border-pr/30 bg-pr/15 text-pr">Check match</Badge>
  );

  const onPick = (v: string) => {
    if (v === "__create") onChange({ exerciseId: null, create: guessFor(d), status: "none" });
    else if (v === "__search") onSearch();
    else onChange({ exerciseId: v, create: null, status: "chosen" });
  };

  const setRow = (i: number, p: Partial<DraftSet>) => onChange({ perSet: d.perSet.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const toPerSet = () => {
    const n = Math.max(1, Math.min(20, Math.round(Number(d.sets)) || 1));
    onChange({ mode: "perSet", perSet: Array.from({ length: n }, () => ({ reps: d.reps.replace(/.*[-–]/, ""), weight: d.weight, duration: d.duration, distance: d.distance })) });
  };
  const toUniform = () => {
    const f = d.perSet[0];
    onChange({ mode: "uniform", sets: String(Math.max(1, d.perSet.length)), reps: f?.reps ?? "", weight: f?.weight ?? "", duration: f?.duration ?? "", distance: f?.distance ?? "" });
  };

  const field = "h-10 px-2 text-center text-sm";
  const NEXT_TYPE = { N: "W", W: "D", D: "F", F: "N" } as const;
  const TYPE_NAME = { N: "Working set", W: "Warm-up set", D: "Drop set", F: "Set to failure" } as const;
  const TYPE_STYLE = { N: "text-muted", W: "bg-pr/15 text-pr", D: "bg-accent/15 text-accent", F: "bg-danger/15 text-danger" } as const;

  return (
    <div className="rounded-xl border border-line bg-field/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{d.create ? d.create.name || d.raw : (chosen?.name ?? d.raw)}</div>
          {(chosen?.name ?? d.create?.name) !== d.raw && <div className="truncate text-xs text-muted">written as “{d.raw}”</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {badge}
          <IconButton label="Remove exercise" onClick={onRemove} className="h-8 w-8">
            <X size={16} />
          </IconButton>
        </div>
      </div>

      <div className="mt-2">
        <Select value={d.create ? "__create" : (d.exerciseId ?? "")} onChange={(e) => onPick(e.target.value)} aria-label={`Exercise for ${d.raw}`} className="h-10 text-sm">
          {!resolved && (
            <option value="" disabled>
              Choose an exercise…
            </option>
          )}
          {chosen && !d.suggestions.some((s) => s.id === chosen.id) && <option value={chosen.id}>{chosen.name}</option>}
          {d.suggestions.map((s) => (
            <option key={s.id} value={s.id}>
              {exMap.get(s.id)?.name ?? s.id} · {Math.round(s.score * 100)}%
            </option>
          ))}
          <option value="__search">Search the library…</option>
          <option value="__create">＋ Create “{d.raw}” as a custom exercise</option>
        </Select>
      </div>

      {d.create && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-dashed border-line p-2">
          <div className="col-span-2">
            <Input value={d.create.name} onChange={(e) => onChange({ create: { ...(d.create as ExerciseGuess), name: e.target.value } })} aria-label="Custom exercise name" className="h-10 text-sm" />
          </div>
          <Select value={d.create.primary} onChange={(e) => onChange({ create: { ...(d.create as ExerciseGuess), primary: e.target.value as MuscleGroup } })} aria-label="Primary muscle" className="h-10 text-sm">
            {MUSCLES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <Select value={d.create.equipment} onChange={(e) => onChange({ create: { ...(d.create as ExerciseGuess), equipment: e.target.value as Equipment } })} aria-label="Equipment" className="h-10 text-sm">
            {EQUIPMENT.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <div className="col-span-2">
            <Select value={d.create.type} onChange={(e) => onChange({ create: { ...(d.create as ExerciseGuess), type: e.target.value as MeasureType } })} aria-label="Measurement type" className="h-10 text-sm">
              {(Object.keys(MEASURE_LABELS) as MeasureType[]).map((t) => (
                <option key={t} value={t}>
                  {MEASURE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      {d.noSets && <p className="mt-2 text-xs text-pr">No sets or reps were written — using 3 × 10. Edit below.</p>}

      {d.mode === "uniform" ? (
        <div className="mt-2">
          <div className={cn("grid gap-2", timed ? "grid-cols-3" : "grid-cols-3")}>
            <Cell label="Sets">
              <Input inputMode="numeric" value={d.sets} onChange={(e) => onChange({ sets: e.target.value })} className={field} />
            </Cell>
            {timed ? (
              <>
                <Cell label="Minutes">
                  <Input inputMode="decimal" value={d.duration} onChange={(e) => onChange({ duration: e.target.value })} className={field} />
                </Cell>
                <Cell label="Km">
                  <Input inputMode="decimal" value={d.distance} onChange={(e) => onChange({ distance: e.target.value })} className={field} />
                </Cell>
              </>
            ) : (
              <>
                <Cell label="Reps">
                  <Input value={d.reps} onChange={(e) => onChange({ reps: e.target.value })} placeholder="8 or 10-12" className={field} />
                </Cell>
                <Cell label={unit}>
                  <Input inputMode="decimal" value={d.weight} onChange={(e) => onChange({ weight: e.target.value })} className={field} />
                </Cell>
              </>
            )}
          </div>
          <button type="button" onClick={toPerSet} className="mt-1.5 text-xs font-semibold text-accent">
            Different reps / weight per set
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {d.perSet.map((s, i) => (
            <div key={i} className="grid grid-cols-[1.75rem_1fr_1fr_auto] items-center gap-2">
              <button
                type="button"
                onClick={() => setRow(i, { type: NEXT_TYPE[s.type ?? "N"] })}
                aria-label={`Set ${i + 1} type: ${TYPE_NAME[s.type ?? "N"]}. Tap to change.`}
                title={TYPE_NAME[s.type ?? "N"]}
                className={cn("flex h-8 w-7 items-center justify-center rounded-md text-xs font-bold", TYPE_STYLE[s.type ?? "N"])}
              >
                {s.type && s.type !== "N" ? s.type : i + 1}
              </button>
              {timed ? (
                <>
                  <Input inputMode="decimal" value={s.duration} onChange={(e) => setRow(i, { duration: e.target.value })} placeholder="min" aria-label={`Set ${i + 1} minutes`} className={field} />
                  <Input inputMode="decimal" value={s.distance} onChange={(e) => setRow(i, { distance: e.target.value })} placeholder="km" aria-label={`Set ${i + 1} km`} className={field} />
                </>
              ) : (
                <>
                  <Input inputMode="numeric" value={s.reps} onChange={(e) => setRow(i, { reps: e.target.value })} placeholder="reps" aria-label={`Set ${i + 1} reps`} className={field} />
                  <Input inputMode="decimal" value={s.weight} onChange={(e) => setRow(i, { weight: e.target.value })} placeholder={unit} aria-label={`Set ${i + 1} weight`} className={field} />
                </>
              )}
              <IconButton label="Remove set" onClick={() => onChange({ perSet: d.perSet.filter((_, j) => j !== i) })} className="h-8 w-8" disabled={d.perSet.length <= 1}>
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
          <div className="flex gap-3 pt-0.5">
            <button type="button" onClick={() => onChange({ perSet: [...d.perSet, { ...(d.perSet[d.perSet.length - 1] ?? { reps: "", weight: "", duration: "", distance: "" }) }] })} className="text-xs font-semibold text-accent">
              + Add set
            </button>
            <button type="button" onClick={toUniform} className="text-xs font-semibold text-muted">
              Same for every set
            </button>
          </div>
        </div>
      )}

      <Input value={d.notes} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Notes (tempo, rest, cues…)" aria-label="Notes" className="mt-2 h-10 text-sm" />
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-center text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
