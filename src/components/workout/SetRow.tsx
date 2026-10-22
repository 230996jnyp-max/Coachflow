"use client";

import { Check, Trophy } from "lucide-react";
import type { Exercise, PRKind, SetType, UnitSystem, WorkoutSet } from "@/lib/types";
import { formatSet, PR_LABELS } from "@/lib/stats";
import { cn, fromKg, round, toKg } from "@/lib/utils";
import { ClockCell, NumberCell } from "./cells";

export const SET_CYCLE: SetType[] = ["N", "W", "D", "F"];

const TYPE_STYLE: Record<SetType, string> = {
  N: "text-ink bg-field",
  W: "text-yellow-300 bg-yellow-400/15",
  D: "text-purple-300 bg-purple-400/15",
  F: "text-red-300 bg-red-400/15",
};

export function gridTemplate(ex: Exercise, showRpe: boolean): string {
  switch (ex.type) {
    case "WEIGHT_REPS":
    case "WEIGHTED_BODYWEIGHT":
      return showRpe
        ? "40px minmax(54px,1fr) 66px 56px 48px 44px"
        : "40px minmax(54px,1fr) 72px 64px 44px";
    case "BODYWEIGHT_REPS":
      return showRpe ? "40px minmax(54px,1fr) 72px 52px 44px" : "40px minmax(54px,1fr) 88px 44px";
    case "DURATION_ONLY":
      return "40px minmax(54px,1fr) 100px 44px";
    case "DURATION_DISTANCE":
      return "36px minmax(0,1fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr) 44px";
  }
}

export function SetHeader({ ex, showRpe, unit, wLabel }: { ex: Exercise; showRpe: boolean; unit: UnitSystem; wLabel: string }) {
  const h = "text-center text-[10px] font-bold uppercase tracking-wider text-muted";
  const kg = ex.type === "WEIGHTED_BODYWEIGHT" ? `+${wLabel}` : wLabel;
  void unit;
  return (
    <div className="grid items-center gap-1.5 px-1 pb-1" style={{ gridTemplateColumns: gridTemplate(ex, showRpe) }}>
      <div className={h}>Set</div>
      <div className={cn(h, ex.type === "DURATION_DISTANCE" && "hidden sm:block")}>Previous</div>
      {ex.type === "DURATION_DISTANCE" ? (
        <>
          <div className={h}>KM</div>
          <div className={h}>Time</div>
          <div className={h}>Lvl</div>
        </>
      ) : ex.type === "DURATION_ONLY" ? (
        <div className={h}>Time</div>
      ) : (
        <>
          {ex.type !== "BODYWEIGHT_REPS" && <div className={h}>{kg}</div>}
          <div className={h}>Reps</div>
          {showRpe && <div className={h}>RPE</div>}
        </>
      )}
      <div className={h}>
        <Check size={14} className="mx-auto" />
      </div>
    </div>
  );
}

export function SetRow({
  set,
  label,
  ex,
  prev,
  unit,
  showRpe,
  repHint,
  prFlags,
  coachEdited,
  onChange,
  onToggleDone,
  onCycleType,
  onFillPrev,
}: {
  set: WorkoutSet;
  label: string;
  ex: Exercise;
  prev?: WorkoutSet;
  unit: UnitSystem;
  showRpe: boolean;
  repHint?: string;
  prFlags?: PRKind[];
  /** The coach changed this set from the live group grid. */
  coachEdited?: boolean;
  onChange: (patch: Partial<WorkoutSet>) => void;
  onToggleDone: () => void;
  onCycleType: () => void;
  onFillPrev: () => void;
}) {
  const showW = (v?: number) => (v === undefined ? undefined : round(fromKg(v, unit), 2));
  const prevText = formatSet(prev, ex, unit);
  const grid = gridTemplate(ex, showRpe);
  const cardio = ex.type === "DURATION_DISTANCE";

  return (
    <div className={cn("rounded-xl px-1 py-1 transition-colors", set.done && "bg-success/10")}>
      <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: grid }}>
        <button
          type="button"
          onClick={onCycleType}
          aria-label={`Set ${label}, tap to change set type`}
          title="Tap to cycle: warm-up → normal → drop → failure"
          className={cn("flex h-11 w-full items-center justify-center rounded-lg text-sm font-bold", TYPE_STYLE[set.type])}
        >
          {label}
        </button>

        <button
          type="button"
          onClick={onFillPrev}
          disabled={!prev}
          className={cn(
            "h-11 min-w-0 truncate rounded-lg px-1 text-center text-xs text-muted enabled:hover:bg-field enabled:hover:text-ink disabled:cursor-default",
            cardio && "hidden sm:block",
          )}
        >
          {prevText}
        </button>

        {cardio ? (
          <>
            <NumberCell label="Distance in km" value={set.distanceKm} onChange={(v) => onChange({ distanceKm: v })} placeholder="0.0" done={set.done} />
            <ClockCell label="Duration" value={set.durationSec} onChange={(v) => onChange({ durationSec: v })} done={set.done} />
            <NumberCell label="Level or incline" value={set.level} onChange={(v) => onChange({ level: v })} placeholder="–" done={set.done} />
          </>
        ) : ex.type === "DURATION_ONLY" ? (
          <ClockCell label="Duration" value={set.durationSec} onChange={(v) => onChange({ durationSec: v })} done={set.done} />
        ) : (
          <>
            {ex.type !== "BODYWEIGHT_REPS" && (
              <NumberCell
                label="Weight"
                value={showW(set.weight)}
                onChange={(v) => onChange({ weight: v === undefined ? undefined : toKg(v, unit) })}
                placeholder={prev?.weight !== undefined ? String(showW(prev.weight)) : "0"}
                done={set.done}
              />
            )}
            <NumberCell
              label="Reps"
              value={set.reps}
              onChange={(v) => onChange({ reps: v })}
              decimals={false}
              placeholder={repHint ?? (prev?.reps !== undefined ? String(prev.reps) : "0")}
              done={set.done}
            />
            {showRpe && (
              <NumberCell label="RPE" value={set.rpe} onChange={(v) => onChange({ rpe: v }) } max={10} placeholder="–" done={set.done} />
            )}
          </>
        )}

        <button
          type="button"
          onClick={onToggleDone}
          aria-label={set.done ? "Mark set incomplete" : "Mark set complete"}
          aria-pressed={set.done}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-lg transition-colors",
            set.done ? "bg-success text-white" : "bg-field text-muted hover:text-ink",
          )}
        >
          <Check size={20} strokeWidth={3} />
        </button>
      </div>

      {cardio && (
        <div className="mt-1 flex items-center gap-2 px-1 text-xs text-muted sm:hidden">
          <span>Prev: {prevText}</span>
        </div>
      )}

      {cardio && (
        <div className="mt-1.5 flex items-center gap-2 px-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Kcal</span>
          <div className="w-20">
            <NumberCell label="Calories" value={set.calories} onChange={(v) => onChange({ calories: v })} decimals={false} placeholder="–" done={set.done} className="h-9" />
          </div>
        </div>
      )}

      {coachEdited && (
        <div className="mt-1 px-1 pb-1">
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">Edited by coach</span>
        </div>
      )}

      {prFlags && prFlags.length > 0 && set.done && (
        <div className="mt-1 flex flex-wrap gap-1 px-1 pb-1">
          {prFlags.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 rounded-full bg-pr/15 px-2 py-0.5 text-[11px] font-bold text-pr">
              <Trophy size={11} /> {PR_LABELS[f]} PR
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
