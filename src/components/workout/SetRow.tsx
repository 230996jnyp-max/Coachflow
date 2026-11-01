"use client";

import { Check, Trophy } from "lucide-react";
import type { Exercise, PRKind, SetType, UnitSystem, WorkoutSet } from "@/lib/types";
import { formatSet, PR_LABELS } from "@/lib/stats";
import { computeCol, formatCustomSet, formatValue } from "@/lib/tracking";
import { cn, fromKg, round, toKg } from "@/lib/utils";
import { cellBase, ClockCell, NumberCell } from "./cells";

export const SET_CYCLE: SetType[] = ["N", "W", "D", "F"];

const TYPE_STYLE: Record<SetType, string> = {
  N: "text-ink bg-field",
  W: "text-pr bg-pr/15",
  D: "text-purple bg-purple/15",
  F: "text-danger bg-danger/15",
};

export function gridTemplate(ex: Exercise, showRpe: boolean): string {
  // A sport drill with its own columns: set number, one cell per column (text / choices get more room), done tick.
  if (ex.tracking) return `36px ${ex.tracking.columns.map((c) => (c.kind === "select" || c.kind === "text" ? "minmax(0,1.5fr)" : "minmax(0,1fr)")).join(" ")} 44px`;
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
  if (ex.tracking) {
    return (
      <div className="grid items-center gap-1.5 px-1 pb-1" style={{ gridTemplateColumns: gridTemplate(ex, showRpe) }}>
        <div className={h}>Set</div>
        {ex.tracking.columns.map((c) => (
          <div key={c.key} className={cn(h, "truncate !text-[9px] !tracking-normal")} title={c.unit ? `${c.label} (${c.unit})` : c.label}>
            {c.label}
            {c.unit && c.kind === "number" ? ` ${c.unit}` : ""}
          </div>
        ))}
        <div className={h}>
          <Check size={14} className="mx-auto" />
        </div>
      </div>
    );
  }
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
  suggest,
  onApplySuggest,
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
  /** "Suggested today" for this set (tap to fill it in). */
  suggest?: { text: string; deload: boolean };
  onApplySuggest?: () => void;
  onChange: (patch: Partial<WorkoutSet>) => void;
  onToggleDone: () => void;
  onCycleType: () => void;
  onFillPrev: () => void;
}) {
  if (ex.tracking) {
    return <CustomSetRow set={set} label={label} ex={ex} prev={prev} coachEdited={coachEdited} suggest={suggest} onApplySuggest={onApplySuggest} onChange={onChange} onToggleDone={onToggleDone} onCycleType={onCycleType} onFillPrev={onFillPrev} />;
  }
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
            set.done ? "bg-success text-on-success" : "bg-field text-muted hover:text-ink",
          )}
        >
          <Check size={20} strokeWidth={3} />
        </button>
      </div>

      {suggest && !set.done && (
        <button
          type="button"
          onClick={onApplySuggest}
          aria-label={`Use the suggested target: ${suggest.text}`}
          className={cn("mt-1 inline-flex min-h-8 max-w-full items-center gap-1 truncate rounded-full px-2.5 py-1 text-[11px] font-bold", suggest.deload ? "bg-pr/15 text-pr" : "bg-accent/15 text-accent")}
        >
          {suggest.deload ? "⚡ " : ""}Suggested: {suggest.text}
        </button>
      )}

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

/** A set of a sport drill: one cell per column of the exercise's tracking format (numbers, times, text, choices, calculations). */
function CustomSetRow({
  set,
  label,
  ex,
  prev,
  coachEdited,
  suggest,
  onApplySuggest,
  onChange,
  onToggleDone,
  onCycleType,
  onFillPrev,
}: {
  set: WorkoutSet;
  label: string;
  ex: Exercise;
  prev?: WorkoutSet;
  coachEdited?: boolean;
  suggest?: { text: string; deload: boolean };
  onApplySuggest?: () => void;
  onChange: (patch: Partial<WorkoutSet>) => void;
  onToggleDone: () => void;
  onCycleType: () => void;
  onFillPrev: () => void;
}) {
  const tk = ex.tracking!;
  const setVal = (key: string, v: number | string | undefined) => {
    const next = { ...(set.custom ?? {}) };
    if (v === undefined || v === "") delete next[key];
    else next[key] = v;
    onChange({ custom: Object.keys(next).length ? next : undefined });
  };
  return (
    <div className={cn("rounded-xl px-1 py-1 transition-colors", set.done && "bg-success/10")}>
      <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: gridTemplate(ex, false) }}>
        <button
          type="button"
          onClick={onCycleType}
          aria-label={`Set ${label}, tap to change set type`}
          title="Tap to cycle: warm-up → normal → drop → failure"
          className={cn("flex h-11 w-full items-center justify-center rounded-lg text-sm font-bold", TYPE_STYLE[set.type])}
        >
          {label}
        </button>
        {tk.columns.map((c) => {
          const raw = set.custom?.[c.key];
          const prevRaw = prev?.custom?.[c.key];
          const aria = c.unit ? `${c.label} (${c.unit})` : c.label;
          if (c.kind === "number")
            return <NumberCell key={c.key} label={aria} value={typeof raw === "number" ? raw : undefined} onChange={(v) => setVal(c.key, v)} placeholder={typeof prevRaw === "number" ? String(prevRaw) : "0"} done={set.done} />;
          if (c.kind === "duration") return <ClockCell key={c.key} label={aria} value={typeof raw === "number" ? raw : undefined} onChange={(v) => setVal(c.key, v)} done={set.done} />;
          if (c.kind === "select")
            return (
              <select key={c.key} aria-label={aria} value={typeof raw === "string" ? raw : ""} onChange={(e) => setVal(c.key, e.target.value || undefined)} className={cn(cellBase, "appearance-none px-1 text-xs", set.done && "bg-success/15")}>
                <option value="">{typeof prevRaw === "string" ? prevRaw : "–"}</option>
                {c.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            );
          if (c.kind === "text")
            return <input key={c.key} aria-label={aria} type="text" value={typeof raw === "string" ? raw : ""} maxLength={40} placeholder={typeof prevRaw === "string" ? prevRaw : "–"} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setVal(c.key, e.target.value)} className={cn(cellBase, "px-1 text-xs", set.done && "bg-success/15")} />;
          const calc = formatValue(c, computeCol(c, set.custom));
          return (
            <div key={c.key} aria-label={aria} className="flex h-11 min-w-0 items-center justify-center truncate rounded-lg bg-accent/10 px-1 text-xs font-bold tabular-nums text-accent">
              {calc || "–"}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onToggleDone}
          aria-label={set.done ? "Mark set incomplete" : "Mark set complete"}
          aria-pressed={set.done}
          className={cn("flex h-11 w-11 items-center justify-center rounded-lg transition-colors", set.done ? "bg-success text-on-success" : "bg-field text-muted hover:text-ink")}
        >
          <Check size={20} strokeWidth={3} />
        </button>
      </div>
      {suggest && !set.done && (
        <button
          type="button"
          onClick={onApplySuggest}
          aria-label={`Use the suggested target: ${suggest.text}`}
          className={cn("mt-1 inline-flex min-h-8 max-w-full items-center gap-1 truncate rounded-full px-2.5 py-1 text-[11px] font-bold", suggest.deload ? "bg-pr/15 text-pr" : "bg-accent/15 text-accent")}
        >
          {suggest.deload ? "⚡ " : ""}Suggested: {suggest.text}
        </button>
      )}
      {prev && (
        <button type="button" onClick={onFillPrev} className="mt-1 block w-full truncate rounded-md px-1 text-left text-[11px] text-muted hover:text-ink">
          Previous: {formatCustomSet(prev, tk)} <span className="text-accent">· tap to copy</span>
        </button>
      )}
      {coachEdited && (
        <div className="mt-1 px-1 pb-1">
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">Edited by coach</span>
        </div>
      )}
    </div>
  );
}
