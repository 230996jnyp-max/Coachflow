"use client";

import { format, parseISO } from "date-fns";
import { Check, Eraser, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Field, Input, Notice, Segmented, Select, Textarea } from "@/components/ui";
import {
  CLEARANCE_MESSAGE,
  DECLARATION_STATEMENTS,
  EXPERIENCE,
  FORM_LABEL,
  GOAL_CATEGORIES,
  PARQ_QUESTIONS,
  STRESS_LEVELS,
  TIMES,
  WEEKDAYS,
  WORK_TYPES,
  cleanForm,
  emptyGoals,
  emptyParq,
  parqFlags,
  type DeclarationData,
  type FormData,
  type FormKind,
  type GoalsData,
  type ParqData,
} from "@/lib/intakeForms";
import { cn } from "@/lib/utils";

/*
 * Drawing and reading the three "Before we meet" forms. FormFill is what a client fills in; FormView shows what was recorded (to the
 * coach, and to the client as their copy). The server checks everything again; these checks are only to help early.
 */

export function FormFill<K extends FormKind>({
  kind,
  minor,
  initial,
  clientName,
  onSubmit,
  onCancel,
  preview = false,
}: {
  kind: K;
  minor: boolean;
  initial?: FormData[K] | null;
  clientName: string;
  /** Resolves to an error message, or null when it was saved. */
  onSubmit: (data: FormData[K]) => Promise<string | null>;
  onCancel: () => void;
  /** A coach looking at the form the way a client sees it: everything works, nothing is saved or sent. */
  preview?: boolean;
}) {
  const [data, setData] = useState<FormData[K]>(() => (initial ? structuredClone(initial) : (kind === "PARQ" ? emptyParq() : kind === "GOALS" ? emptyGoals() : { agreed: false, typedName: "", date: "", emergencyName: "", emergencyPhone: "" }) as FormData[K]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const check = cleanForm(kind, data, { minor });
    if (!check.ok) return setError(check.error);
    setError(null);
    setBusy(true);
    const err = await onSubmit(check.data);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="space-y-5">
      {kind === "PARQ" && <ParqFields value={data as ParqData} onChange={(v) => setData(v as FormData[K])} />}
      {kind === "DECLARATION" && <DeclarationFields value={data as DeclarationData} onChange={(v) => setData(v as FormData[K])} minor={minor} clientName={clientName} />}
      {kind === "GOALS" && <GoalsFields value={data as GoalsData} onChange={(v) => setData(v as FormData[K])} />}
      {error && <Notice tone="error">{error}</Notice>}
      {preview ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">Preview only: your client’s Submit button is here, but nothing is saved or sent.</span>
          <Button onClick={onCancel}>Close preview</Button>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            <Check size={16} /> {busy ? "Saving…" : initial ? "Save a new version" : "Submit"}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Health questionnaire ---------------- */
function ParqFields({ value, onChange }: { value: ParqData; onChange: (v: ParqData) => void }) {
  const flags = parqFlags(value);
  return (
    <div className="space-y-4">
      {PARQ_QUESTIONS.map((q, i) => {
        const a = value.answers[q.id];
        return (
          <div key={q.id} className="rounded-xl border border-line p-3">
            <div className="text-sm font-medium">
              {i + 1}. {q.text}
            </div>
            <div className="mt-2">
              <Segmented
                value={(a ?? "") as "yes" | "no" | ""}
                onChange={(v) => v && onChange({ ...value, answers: { ...value.answers, [q.id]: v } })}
                options={[
                  { value: "no", label: "No" },
                  { value: "yes", label: "Yes" },
                ]}
              />
            </div>
            {a === "yes" && (
              <div className="mt-3">
                <Field label="Tell us a little more (optional)">
                  <Textarea value={value.details[q.id] ?? ""} maxLength={300} onChange={(e) => onChange({ ...value, details: { ...value.details, [q.id]: e.target.value } })} />
                </Field>
              </div>
            )}
          </div>
        );
      })}
      <Field label="Anything else about your health your coach should know? (optional)">
        <Textarea value={value.other} maxLength={600} onChange={(e) => onChange({ ...value, other: e.target.value })} />
      </Field>
      {flags.length > 0 && (
        <Notice tone="warn">
          You answered yes to {flags.length === 1 ? "one question" : `${flags.length} questions`}. That’s fine: you can still train. Your coach will see it, and it’s a good idea to check with your doctor before training hard.
        </Notice>
      )}
    </div>
  );
}

/* ---------------- Declaration ---------------- */
function DeclarationFields({ value, onChange, minor, clientName }: { value: DeclarationData; onChange: (v: DeclarationData) => void; minor: boolean; clientName: string }) {
  const [today] = useState(() => format(new Date(), "d MMM yyyy"));
  return (
    <div className="space-y-4">
      {minor && <Notice tone="info">You’re under 18, so a parent or guardian needs to read and agree to this with you. Type their full name below.</Notice>}
      <ul className="space-y-2 rounded-xl border border-line bg-field/40 p-4 text-sm">
        {DECLARATION_STATEMENTS.map((s) => (
          <li key={s} className="flex gap-2">
            <span aria-hidden className="mt-0.5 text-accent">
              •
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-accent" checked={value.agreed} onChange={(e) => onChange({ ...value, agreed: e.target.checked })} />
        <span className="font-medium">I have read this and I agree.</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Type your full name to sign`} hint={clientName ? `For example: ${clientName}` : undefined}>
          <Input value={value.typedName} onChange={(e) => onChange({ ...value, typedName: e.target.value })} autoComplete="name" />
        </Field>
        <Field label="Date">
          <Input value={today} readOnly aria-readonly />
        </Field>
        {minor && (
          <Field label="Parent or guardian’s full name">
            <Input value={value.guardianName ?? ""} onChange={(e) => onChange({ ...value, guardianName: e.target.value })} />
          </Field>
        )}
        <Field label="Emergency contact name (optional)">
          <Input value={value.emergencyName} onChange={(e) => onChange({ ...value, emergencyName: e.target.value })} />
        </Field>
        <Field label="Emergency contact phone (optional)">
          <Input value={value.emergencyPhone} onChange={(e) => onChange({ ...value, emergencyPhone: e.target.value })} inputMode="tel" />
        </Field>
      </div>
      <div>
        <div className="mb-1 text-sm font-medium">Draw your signature (optional)</div>
        <p className="mb-2 text-xs text-muted">Your typed name and the tick above already count as your signature. Drawing one is just if you’d like to.</p>
        <SignaturePad value={value.signature} onChange={(s) => onChange({ ...value, signature: s })} />
      </div>
    </div>
  );
}

/** A small drawing box. The picture is saved as a small PNG; clearing removes it. */
export function SignaturePad({ value, onChange }: { value?: string; onChange: (png: string | undefined) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    // Show an existing signature (when editing a new version of a form that had one).
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !value) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
    img.src = value;
  }, [value]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const stroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const finish = (c: HTMLCanvasElement) => {
    drawing.current = false;
    last.current = null;
    const out = c.toDataURL("image/png");
    onChange(out.length < 100_000 ? out : undefined);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        width={360}
        height={120}
        aria-label="Signature box. Draw with your finger or mouse."
        className="h-[120px] w-full max-w-[360px] touch-none rounded-xl border border-line bg-white"
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* some browsers refuse; drawing still works inside the box */
          }
          drawing.current = true;
          last.current = pos(e);
        }}
        onPointerMove={(e) => drawing.current && stroke(e)}
        onPointerUp={(e) => drawing.current && finish(e.currentTarget)}
        onPointerCancel={(e) => drawing.current && finish(e.currentTarget)}
      />
      {value && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const c = ref.current;
            c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
            onChange(undefined);
          }}
        >
          <Eraser size={14} /> Clear
        </Button>
      )}
    </div>
  );
}

/* ---------------- Goals ---------------- */
function GoalsFields({ value, onChange }: { value: GoalsData; onChange: (v: GoalsData) => void }) {
  const set = <K extends keyof GoalsData>(k: K, v: GoalsData[K]) => onChange({ ...value, [k]: v });
  const toggle = (k: "days" | "times", v: string) => set(k, (value[k].includes(v) ? value[k].filter((x) => x !== v) : [...value[k], v]) as never);
  const chip = (on: boolean) => cn("min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors", on ? "border-accent bg-accent text-on-accent" : "border-line bg-field text-muted hover:text-ink");
  return (
    <div className="space-y-4">
      <Field label="What do you want to achieve?">
        <Textarea value={value.mainGoal} maxLength={300} onChange={(e) => set("mainGoal", e.target.value)} placeholder="For example: lose 6 kg and feel stronger before my wedding" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Which fits best?">
          <Select value={value.goalCategory} onChange={(e) => set("goalCategory", e.target.value as GoalsData["goalCategory"])}>
            <option value="">Not sure</option>
            {GOAL_CATEGORIES.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>
        <Field label="Training experience">
          <Select value={value.experience} onChange={(e) => set("experience", e.target.value as GoalsData["experience"])}>
            <option value="">Not sure</option>
            {EXPERIENCE.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>
        <Field label="A target event (optional)">
          <Input value={value.targetEvent} maxLength={80} onChange={(e) => set("targetEvent", e.target.value)} placeholder="Marathon, wedding, holiday…" />
        </Field>
        <Field label="Event date (optional)">
          <Input type="date" value={value.targetDate} onChange={(e) => set("targetDate", e.target.value)} />
        </Field>
      </div>
      <Field label="Past injuries or things that hurt (optional)">
        <Textarea value={value.pastInjuries} maxLength={600} onChange={(e) => set("pastInjuries", e.target.value)} />
      </Field>
      <div>
        <div className="mb-2 text-sm font-medium">Days you can usually train</div>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <button key={d} type="button" aria-pressed={value.days.includes(d)} className={chip(value.days.includes(d))} onClick={() => toggle("days", d)}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">Times that suit you</div>
        <div className="flex flex-wrap gap-2">
          {TIMES.map((d) => (
            <button key={d} type="button" aria-pressed={value.times.includes(d)} className={chip(value.times.includes(d))} onClick={() => toggle("times", d)}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sessions a week you’d like">
          <Select value={String(value.sessionsPerWeek)} onChange={(e) => set("sessionsPerWeek", Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Hours of sleep, on average">
          <Input type="number" min={2} max={14} step={0.5} value={value.sleepHours} onChange={(e) => set("sleepHours", Number(e.target.value))} />
        </Field>
        <Field label="Stress">
          <Select value={value.stress} onChange={(e) => set("stress", e.target.value as GoalsData["stress"])}>
            <option value="">Prefer not to say</option>
            {STRESS_LEVELS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>
        <Field label="Your day is mostly">
          <Select value={value.workType} onChange={(e) => set("workType", e.target.value as GoalsData["workType"])}>
            <option value="">Prefer not to say</option>
            {WORK_TYPES.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Eating habits or allergies (optional)">
        <Textarea value={value.dietNotes} maxLength={600} onChange={(e) => set("dietNotes", e.target.value)} />
      </Field>
      <Field label="Anything else? (optional)">
        <Textarea value={value.anythingElse} maxLength={600} onChange={(e) => set("anythingElse", e.target.value)} />
      </Field>
    </div>
  );
}

/* ---------------- Reading what was recorded ---------------- */
const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-0.5 border-t border-line py-2 first:border-t-0 sm:flex-row sm:gap-4">
    <dt className="w-44 shrink-0 text-xs font-semibold text-muted sm:text-sm sm:font-normal">{label}</dt>
    <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{children}</dd>
  </div>
);

export function FormView({ kind, data }: { kind: FormKind; data: FormData[FormKind] }) {
  if (kind === "PARQ") {
    const d = data as ParqData;
    const flags = parqFlags(d);
    return (
      <div className="space-y-3">
        {flags.length > 0 && (
          <Notice tone="warn">
            <span className="flex items-start gap-2">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              <span>{CLEARANCE_MESSAGE}</span>
            </span>
          </Notice>
        )}
        <dl>
          {PARQ_QUESTIONS.map((q) => (
            <Row key={q.id} label={q.text}>
              <span className={cn("font-semibold", d.answers[q.id] === "yes" ? "text-danger" : "text-muted")}>{d.answers[q.id] === "yes" ? "Yes" : "No"}</span>
              {d.details[q.id] ? <span className="block text-muted">{d.details[q.id]}</span> : null}
            </Row>
          ))}
          {d.other && <Row label="Anything else">{d.other}</Row>}
        </dl>
      </div>
    );
  }
  if (kind === "DECLARATION") {
    const d = data as DeclarationData;
    return (
      <dl>
        <Row label="Agreed">Yes, to all {DECLARATION_STATEMENTS.length} statements</Row>
        <Row label="Signed by">{d.typedName}</Row>
        <Row label="Date">{safeDate(d.date)}</Row>
        {d.guardianName && <Row label="Parent or guardian">{d.guardianName}</Row>}
        {(d.emergencyName || d.emergencyPhone) && <Row label="Emergency contact">{[d.emergencyName, d.emergencyPhone].filter(Boolean).join(" · ")}</Row>}
        {d.signature && (
          <Row label="Signature">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.signature} alt="Drawn signature" className="h-16 rounded border border-line bg-white" />
          </Row>
        )}
      </dl>
    );
  }
  const g = data as GoalsData;
  return (
    <dl>
      <Row label="Main goal">{g.mainGoal}</Row>
      {g.goalCategory && <Row label="Goal type">{g.goalCategory}</Row>}
      {g.experience && <Row label="Experience">{g.experience}</Row>}
      {(g.targetEvent || g.targetDate) && <Row label="Target event">{[g.targetEvent, g.targetDate ? safeDate(g.targetDate) : ""].filter(Boolean).join(" · ")}</Row>}
      {g.pastInjuries && <Row label="Past injuries">{g.pastInjuries}</Row>}
      {g.days.length > 0 && <Row label="Days">{g.days.join(", ")}</Row>}
      {g.times.length > 0 && <Row label="Times">{g.times.join(", ")}</Row>}
      <Row label="Sessions a week">{g.sessionsPerWeek}</Row>
      <Row label="Sleep">{g.sleepHours} hours</Row>
      {g.stress && <Row label="Stress">{g.stress}</Row>}
      {g.workType && <Row label="Day is mostly">{g.workType}</Row>}
      {g.dietNotes && <Row label="Eating">{g.dietNotes}</Row>}
      {g.anythingElse && <Row label="Anything else">{g.anythingElse}</Row>}
    </dl>
  );
}

export const safeDate = (iso: string): string => {
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
};

export const formTitle = (k: FormKind) => FORM_LABEL[k];
