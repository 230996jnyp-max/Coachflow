"use client";

import { HeartPulse } from "lucide-react";
import { Badge, Field, Textarea } from "@/components/ui";
import { hasFeedback, PAIN_ALERT, PAIN_AREAS, painLevel, type PainLevel, type WorkoutFeedback } from "@/lib/feedback";
import { cn } from "@/lib/utils";

const LEVEL_TONE: Record<PainLevel, string> = {
  none: "border-success/30 bg-success/15 text-success",
  mild: "border-success/30 bg-success/15 text-success",
  moderate: "border-pr/30 bg-pr/15 text-pr",
  high: "border-danger/30 bg-danger/15 text-danger",
};

/** Small "Pain 7 · Energy 4" badge for workout lists (nothing when no feedback was given). */
export function FeelingBadge({ feedback, className }: { feedback: WorkoutFeedback | undefined; className?: string }) {
  if (!hasFeedback(feedback)) return null;
  const { pain, energy } = feedback;
  return (
    <Badge className={cn(pain !== undefined ? LEVEL_TONE[painLevel(pain)] : "border-accent/30 bg-accent/15 text-accent", className)}>
      <HeartPulse size={11} />
      {pain !== undefined && <span>Pain {pain}</span>}
      {pain !== undefined && energy !== undefined && <span aria-hidden>·</span>}
      {energy !== undefined && <span>Energy {energy}</span>}
    </Badge>
  );
}

function Scale({ label, value, onChange, tone }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; tone: (n: number) => string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-sm font-bold text-muted">{value ?? "—"}</span>
      </div>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
        {Array.from({ length: 11 }, (_, n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on ? undefined : n)}
              className={cn("h-11 rounded-lg border text-sm font-semibold transition-colors", on ? tone(n) : "border-line bg-field text-muted hover:text-ink")}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const painTone = (n: number) => {
  const l = painLevel(n);
  return l === "high" ? "border-danger bg-danger text-on-danger" : l === "moderate" ? "border-pr bg-pr text-on-pr" : "border-success bg-success text-on-success";
};
const energyTone = () => "border-accent bg-accent text-on-accent";

/**
 * "How did it feel?" — pain and energy 0–10, where it hurt (when there was pain) and optional notes. Everything is optional.
 * Shown when a workout is finished, and on logged workouts; the coach sees it on the workout and in the client's progress.
 */
export function FeelingCard({
  feedback,
  onChange,
  notes,
  onNotes,
}: {
  feedback: WorkoutFeedback | undefined;
  onChange: (f: WorkoutFeedback | undefined) => void;
  /** When given, the notes box is shown here (it edits the workout's session notes). */
  notes?: string;
  onNotes?: (v: string) => void;
}) {
  const f = feedback ?? {};
  const set = (patch: Partial<WorkoutFeedback>) => {
    const next: WorkoutFeedback = { ...f, ...patch };
    if (!next.pain) delete next.areas; // areas only make sense with pain
    if (next.pain === undefined && next.energy === undefined) return onChange(undefined);
    onChange(next);
  };
  const areas = f.areas ?? [];

  return (
    <div className="space-y-4">
      <div className="text-xs font-bold uppercase tracking-wider text-muted">How did it feel?</div>
      <Scale label="Pain" value={f.pain} onChange={(v) => set({ pain: v })} tone={painTone} />
      {f.pain !== undefined && f.pain > 0 && (
        <div>
          <div className="mb-1.5 text-sm font-semibold">Where does it hurt? <span className="font-normal text-muted">(optional)</span></div>
          <div className="flex flex-wrap gap-1.5">
            {PAIN_AREAS.map((a) => {
              const on = areas.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ areas: on ? areas.filter((x) => x !== a) : [...areas, a] })}
                  className={cn("min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors", on ? "border-danger bg-danger/15 text-danger" : "border-line bg-field text-muted hover:text-ink")}
                >
                  {a}
                </button>
              );
            })}
          </div>
          {f.pain >= PAIN_ALERT && <p className="mt-2 text-xs text-danger">Your coach will be told about this so they can adjust your training.</p>}
        </div>
      )}
      <Scale label="Energy" value={f.energy} onChange={(v) => set({ energy: v })} tone={energyTone} />
      {onNotes && (
        <Field label="Notes (optional)">
          <Textarea value={notes ?? ""} onChange={(e) => onNotes(e.target.value)} placeholder="Anything worth remembering?" rows={2} className="min-h-16" />
        </Field>
      )}
    </div>
  );
}
