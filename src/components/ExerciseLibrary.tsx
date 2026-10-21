"use client";

import { Check, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EQUIPMENT, MEASURE_LABELS, MUSCLES } from "@/data/exercises";
import { useViewer } from "@/lib/hooks";
import { addExercise } from "@/lib/store";
import type { Equipment, Exercise, MeasureType, MuscleGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Button, Field, Input, Modal, Select } from "./ui";

function subsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

export function searchExercises(list: Exercise[], query: string): Exercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const aliases: Record<string, string> = { rdl: "romanian deadlift", rdls: "romanian deadlift", ohp: "overhead press", db: "dumbbell", bb: "barbell" };
  const tokens = q.split(/\s+/).map((t) => aliases[t] ?? t);
  const scored: { ex: Exercise; score: number }[] = [];
  for (const ex of list) {
    const hay = `${ex.name} ${ex.primary} ${ex.equipment} ${ex.secondary.join(" ")}`.toLowerCase();
    const name = ex.name.toLowerCase();
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      if (name.includes(t)) score += name.startsWith(t) ? 4 : 3;
      else if (hay.includes(t)) score += 2;
      else if (t.length >= 3 && subsequence(t, name.replace(/[^a-z]/g, ""))) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok) scored.push({ ex, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.ex.name.localeCompare(b.ex.name)).map((s) => s.ex);
}

/**
 * Hides a sticky bar while the user scrolls down and brings it back only after a deliberate
 * upward scroll (or when back at the top). Works for a modal's scroll container or the window.
 */
function useHideOnScroll(ref: React.RefObject<HTMLElement | null>): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      scroller = scroller.parentElement;
    }
    const target: HTMLElement | Window = scroller ?? window;
    const top = () => (scroller ? scroller.scrollTop : window.scrollY);
    let last = top();
    let upTravel = 0;
    const onScroll = () => {
      const cur = top();
      const delta = cur - last;
      last = cur;
      if (cur <= 8) {
        upTravel = 0;
        setHidden(false);
      } else if (delta > 0) {
        upTravel = 0;
        if (cur > 60) setHidden(true);
      } else if (delta < 0) {
        upTravel += -delta;
        if (upTravel > 48) setHidden(false);
      }
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [ref]);
  return hidden;
}

interface BrowserProps {
  exercises: Exercise[];
  selectable?: boolean;
  selected?: string[];
  onToggle?: (ex: Exercise) => void;
  onOpen?: (ex: Exercise) => void;
  restrictTypes?: MeasureType[];
  /** Tailwind `top-*` classes for the sticky bar (page mode sits below the mobile header). */
  stickyOffset?: string;
}

export function ExerciseBrowser({ exercises, selectable, selected = [], onToggle, onOpen, restrictTypes, stickyOffset }: BrowserProps) {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleGroup | "All">("All");
  const [equipment, setEquipment] = useState<Equipment | "All">("All");

  const results = useMemo(() => {
    let list = exercises;
    if (restrictTypes) list = list.filter((e) => restrictTypes.includes(e.type));
    if (muscle !== "All") list = list.filter((e) => e.primary === muscle);
    if (equipment !== "All") list = list.filter((e) => e.equipment === equipment);
    return searchExercises(list, query);
  }, [exercises, query, muscle, equipment, restrictTypes]);

  const barRef = useRef<HTMLDivElement>(null);
  const hidden = useHideOnScroll(barRef);

  return (
    <div>
      <div
        ref={barRef}
        className={cn(
          "sticky z-10 -mx-1 space-y-3 bg-surface px-1 pb-3 transition-transform duration-200",
          stickyOffset ?? "top-0",
          hidden && "pointer-events-none -translate-y-[calc(100%+4rem)]",
        )}
      >
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search e.g. incline bench, RDLs, lat pulldown…" className="pl-9" />
        </div>
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {(["All", ...MUSCLES] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMuscle(m)}
              className={cn(
                "min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors",
                muscle === m ? "border-accent bg-accent text-white" : "border-line bg-field text-muted hover:text-ink",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Select value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment | "All")} className="h-10 flex-1" aria-label="Filter by equipment">
            <option value="All">All equipment</option>
            {EQUIPMENT.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Select>
          <span className="shrink-0 text-xs text-muted">{results.length} exercises</span>
        </div>
      </div>

      <ul className="divide-y divide-line">
        {results.map((ex) => {
          const isSel = selected.includes(ex.id);
          return (
            <li key={ex.id}>
              <button
                onClick={() => (selectable ? onToggle?.(ex) : onOpen?.(ex))}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left transition-colors hover:bg-field/60",
                  isSel && "bg-accent/10",
                )}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    isSel ? "bg-accent text-white" : "bg-field text-muted",
                  )}
                >
                  {isSel ? <Check size={18} /> : ex.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{ex.name}</div>
                  <div className="truncate text-xs text-muted">
                    {ex.primary} · {ex.equipment}
                  </div>
                </div>
                {ex.custom && <Badge className="border-accent/30 bg-accent/15 text-accent">Custom</Badge>}
              </button>
            </li>
          );
        })}
        {results.length === 0 && <li className="py-10 text-center text-sm text-muted">No exercises match. Try a different search or create a custom one.</li>}
      </ul>
    </div>
  );
}

/* ---------- Picker modal for workouts / templates ---------- */
export function ExercisePicker({
  open,
  onClose,
  onConfirm,
  confirmLabel = "Add",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (exerciseIds: string[]) => void;
  confirmLabel?: string;
}) {
  const { db } = useViewer();
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const close = () => {
    setSelected([]);
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="Choose exercises"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(true)} className="mr-auto">
              <Plus size={16} /> Custom
            </Button>
            <Button
              disabled={selected.length === 0}
              onClick={() => {
                onConfirm(selected);
                setSelected([]);
                onClose();
              }}
            >
              {confirmLabel} {selected.length > 0 ? `${selected.length} exercise${selected.length > 1 ? "s" : ""}` : ""}
            </Button>
          </>
        }
      >
        <ExerciseBrowser
          exercises={db.exercises}
          selectable
          selected={selected}
          onToggle={(ex) => setSelected((s) => (s.includes(ex.id) ? s.filter((x) => x !== ex.id) : [...s, ex.id]))}
        />
      </Modal>
      <CreateExerciseModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(ex) => setSelected((s) => [...s, ex.id])}
      />
    </>
  );
}

/* ---------- Create custom exercise ---------- */
export function CreateExerciseModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (ex: Exercise) => void;
}) {
  const [name, setName] = useState("");
  const [primary, setPrimary] = useState<MuscleGroup>("Chest");
  const [secondary, setSecondary] = useState<MuscleGroup[]>([]);
  const [equipment, setEquipment] = useState<Equipment>("Barbell");
  const [type, setType] = useState<MeasureType>("WEIGHT_REPS");

  const reset = () => {
    setName("");
    setSecondary([]);
    setPrimary("Chest");
    setEquipment("Barbell");
    setType("WEIGHT_REPS");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create custom exercise"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => {
              const ex = addExercise({ name: name.trim(), primary, secondary, equipment, type });
              onCreated?.(ex);
              reset();
              onClose();
            }}
          >
            Save exercise
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Exercise name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tempo Back Squat" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Primary muscle">
            <Select value={primary} onChange={(e) => setPrimary(e.target.value as MuscleGroup)}>
              {MUSCLES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Equipment">
            <Select value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
              {EQUIPMENT.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Measurement type">
          <Select value={type} onChange={(e) => setType(e.target.value as MeasureType)}>
            {(Object.keys(MEASURE_LABELS) as MeasureType[]).map((t) => (
              <option key={t} value={t}>
                {MEASURE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Secondary muscles</div>
          <div className="flex flex-wrap gap-1.5">
            {MUSCLES.filter((m) => m !== primary).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSecondary((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs font-semibold",
                  secondary.includes(m) ? "border-accent bg-accent/20 text-accent" : "border-line bg-field text-muted",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
