"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ExercisePicker } from "@/components/ExerciseLibrary";
import { NumberInput } from "@/components/NumberInput";
import { Button, Field, IconButton, Input, Modal, Toggle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { saveTemplate } from "@/lib/store";
import type { RoutineTemplate, TemplateExercise } from "@/lib/types";
import { fromKg, round, toKg, uid, weightUnit } from "@/lib/utils";

export function TemplateEditor({ template, onClose }: { template: Partial<RoutineTemplate> | null; onClose: () => void }) {
  return template ? <Editor key={template.id ?? "new"} template={template} onClose={onClose} /> : null;
}

function Editor({ template, onClose }: { template: Partial<RoutineTemplate>; onClose: () => void }) {
  const { user, isTrainer, exMap, unit } = useViewer();
  const [name, setName] = useState(template.name ?? "");
  const [shared, setShared] = useState(template.shared ?? isTrainer);
  const [items, setItems] = useState<TemplateExercise[]>(template.exercises ?? []);
  const [picker, setPicker] = useState(false);

  const patch = (i: number, p: Partial<TemplateExercise>) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const swap = (i: number, d: -1 | 1) =>
    setItems((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const n = [...l];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={template.id ? "Edit routine template" : "New routine template"}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || items.length === 0}
              onClick={() => {
                if (!user) return;
                saveTemplate({
                  id: template.id ?? uid("t"),
                  ownerId: template.ownerId ?? user.id,
                  name: name.trim(),
                  shared: isTrainer ? shared : false,
                  exercises: items,
                });
                onClose();
              }}
            >
              Save template
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Template name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Upper Body Hypertrophy A" autoFocus />
          </Field>
          {isTrainer && <Toggle checked={shared} onChange={setShared} label="Share with all clients" />}

          <div className="space-y-2">
            {items.map((it, i) => {
              const ex = exMap.get(it.exerciseId);
              const cardio = ex?.type === "DURATION_DISTANCE";
              return (
                <div key={`${it.exerciseId}-${i}`} className="rounded-xl border border-line bg-field p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-semibold">{ex?.name ?? "Unknown exercise"}</div>
                    <div className="flex shrink-0">
                      <IconButton label="Move up" onClick={() => swap(i, -1)} className="h-9 w-9">
                        <ArrowUp size={16} />
                      </IconButton>
                      <IconButton label="Move down" onClick={() => swap(i, 1)} className="h-9 w-9">
                        <ArrowDown size={16} />
                      </IconButton>
                      <IconButton label="Remove" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} className="h-9 w-9">
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>
                  {cardio ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Field label="Minutes">
                        <NumberInput label="Minutes" decimals={2} step={1} allowEmpty value={it.durationSec ? round(it.durationSec / 60, 2) : undefined} onChange={(v) => patch(i, { durationSec: v && v > 0 ? Math.round(v * 60) : undefined })} />
                      </Field>
                      <Field label="Km">
                        <NumberInput label="Km" decimals={2} step={0.5} allowEmpty value={it.distanceKm} onChange={(v) => patch(i, { distanceKm: v && v > 0 ? v : undefined })} />
                      </Field>
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Field label="Sets">
                        <NumberInput label="Sets" min={1} max={12} value={it.sets} onChange={(v) => patch(i, { sets: v ?? it.sets })} />
                      </Field>
                      <Field label={`Weight (${weightUnit(unit)})`}>
                        <NumberInput label="Weight" decimals={1} step={2.5} allowEmpty placeholder="Optional" value={it.weight ? round(fromKg(it.weight, unit), 1) : undefined} onChange={(v) => patch(i, { weight: v && v > 0 ? Math.round(toKg(v, unit) * 100) / 100 : undefined })} />
                      </Field>
                      <Field label="Min reps">
                        <NumberInput label="Min reps" value={it.repMin} onChange={(v) => patch(i, { repMin: v ?? it.repMin })} />
                      </Field>
                      <Field label="Max reps">
                        <NumberInput label="Max reps" value={it.repMax} onChange={(v) => patch(i, { repMax: v ?? it.repMax })} />
                      </Field>
                    </div>
                  )}
                  <Input
                    value={it.notes ?? ""}
                    maxLength={500}
                    onChange={(e) => patch(i, { notes: e.target.value || undefined })}
                    placeholder="Note (tempo, rest, cues…)"
                    aria-label="Exercise note"
                    className="mt-2 h-10 text-sm"
                  />
                </div>
              );
            })}
            {items.length === 0 && <p className="py-4 text-center text-sm text-muted">No exercises yet — add some below.</p>}
          </div>
          <Button variant="outline" className="w-full" onClick={() => setPicker(true)}>
            <Plus size={16} /> Add exercises
          </Button>
        </div>
      </Modal>
      <ExercisePicker
        open={picker}
        onClose={() => setPicker(false)}
        onConfirm={(ids) =>
          setItems((l) => [
            ...l,
            ...ids.map((id) => ({ exerciseId: id, sets: exMap.get(id)?.type === "DURATION_DISTANCE" ? 1 : 3, repMin: 8, repMax: 12 })),
          ])
        }
      />
    </>
  );
}
