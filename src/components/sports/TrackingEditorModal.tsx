"use client";

import { RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Field, Modal, Notice, Select, Textarea } from "@/components/ui";
import { MEASURE_LABELS } from "@/data/exercises";
import { useViewer } from "@/lib/hooks";
import { api, resetTrackingFormat, saveTrackingFormat } from "@/lib/store";
import { describeSchema, isChartable } from "@/lib/tracking";
import type { Exercise, TrackingColumn, TrackingSchema } from "@/lib/types";

const EXAMPLES = [
  "Track this basketball drill by Court Spot, Shots Made, Shots Attempted, and auto-calculate Shooting %",
  "Track this swim set by Stroke Type, Distance (m), Stroke Count per Lap, and Split Time (sec)",
  "Track this boxing drill by Round Duration, Combo Number, and Coach Rating (1-10)",
];

const KIND_LABEL: Record<TrackingColumn["kind"], string> = { number: "Number", duration: "Time", text: "Text", select: "Choice", computed: "Calculated" };

/** The columns of a tracking format, as small chips (the one that is charted is highlighted). */
export function SchemaPreview({ schema }: { schema: TrackingSchema }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {schema.columns.map((c) => (
        <Badge key={c.key} className={c.key === schema.primary ? "border-accent/40 bg-accent/15 text-accent" : undefined}>
          {c.label}
          {c.unit ? ` (${c.unit})` : ""} · {KIND_LABEL[c.kind]}
          {c.key === schema.primary ? " · charted" : ""}
        </Badge>
      ))}
    </div>
  );
}

/**
 * "Customize tracking with AI": the coach says in plain English what to record for an exercise; the AI builds the set-table
 * columns and the chart metric. The coach previews it, can change which value is charted, and saves it for that exercise.
 */
export function TrackingEditorModal({ exercise, onClose }: { exercise: Exercise | null; onClose: () => void }) {
  return exercise ? <Editor key={exercise.id} exercise={exercise} onClose={onClose} /> : null;
}

function Editor({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const { db } = useViewer();
  const overridden = !!db.tracking?.[exercise.id];
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<{ tracking: TrackingSchema; summary: string } | null>(null);
  const [primary, setPrimary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ tracking: TrackingSchema; summary: string }>("/api/ai/custom-tracking", { body: { exerciseName: exercise.name, sport: exercise.discipline, instruction: text.trim(), current: exercise.tracking } });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "The AI couldn't build that. Try again.");
    setProposal(r.data);
    setPrimary(r.data.tracking.primary);
  };

  const save = async () => {
    if (!proposal) return;
    setBusy(true);
    const err = await saveTrackingFormat(exercise.id, { ...proposal.tracking, primary });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  const reset = async () => {
    setBusy(true);
    const err = await resetTrackingFormat(exercise.id);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Customize tracking with AI"
      footer={
        <>
          {overridden && (
            <Button variant="ghost" onClick={reset} disabled={busy} className="mr-auto">
              <RotateCcw size={15} /> Back to default
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {proposal ? (
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save for this exercise"}
            </Button>
          ) : (
            <Button onClick={ask} disabled={busy || text.trim().length < 4}>
              <Sparkles size={15} /> {busy ? "Thinking…" : "Preview with AI"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-sm font-bold">{exercise.name}</div>
          <div className="mt-1 text-xs text-muted">Now tracking: {exercise.tracking ? describeSchema(exercise.tracking) : `${MEASURE_LABELS[exercise.type]} (default)`}</div>
        </div>

        {!proposal ? (
          <>
            <Field label="Tell the AI how to track this exercise" hint="Describe the columns you want, and what to calculate or chart.">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={600} rows={4} placeholder="e.g. Track by Court Spot, Shots Made and Shots Attempted, and work out Shooting %" autoFocus />
            </Field>
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Try one of these</div>
              {EXAMPLES.map((x) => (
                <button key={x} type="button" onClick={() => setText(x)} className="block w-full rounded-xl border border-line bg-field px-3 py-2 text-left text-xs text-muted transition-colors hover:text-ink">
                  {x}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {proposal.summary && <Notice tone="info">{proposal.summary}</Notice>}
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Each set will have</div>
              <SchemaPreview schema={{ ...proposal.tracking, primary }} />
            </div>
            <Field label="Value charted in the client's progress">
              <Select value={primary} onChange={(e) => setPrimary(e.target.value)}>
                {proposal.tracking.columns.filter(isChartable).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-muted">Saved for you and your clients. Past workouts keep what was logged.</p>
            <Button variant="ghost" size="sm" onClick={() => setProposal(null)}>
              ← Change my request
            </Button>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
