"use client";

import { Dumbbell, MessageSquareText } from "lucide-react";
import { describePlan } from "@/lib/assignments";
import { useViewer } from "@/lib/hooks";
import type { TemplateExercise } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The workout as the client will see it, inside a phone frame, so a coach can check what they are about to assign. The same rows are
 * used on the client's own screens (see ExerciseRows).
 */
export function PhonePreview({ title, note, exercises, className }: { title: string; note?: string; exercises: TemplateExercise[]; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[260px]", className)} aria-label="Preview of what your client will see">
      <div className="rounded-[2rem] border-[5px] border-line bg-surface p-1.5 shadow-lg">
        <div className="relative overflow-hidden rounded-[1.5rem] bg-bg">
          <div className="mx-auto mt-1.5 h-4 w-20 rounded-full bg-line" aria-hidden />
          <div className="mt-2 bg-accent px-4 pb-4 pt-3 text-on-accent">
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">Today&apos;s workout</div>
            <div className="mt-0.5 line-clamp-2 text-base font-bold leading-snug">{title || "Choose a routine"}</div>
            <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold opacity-90">
              <Dumbbell size={11} /> {exercises.length} {exercises.length === 1 ? "exercise" : "exercises"}
            </div>
          </div>
          <div className="max-h-[300px] space-y-2 overflow-y-auto p-3">
            {note && (
              <div className="flex gap-2 rounded-xl border border-accent/30 bg-accent/10 p-2.5 text-[11px] leading-snug">
                <MessageSquareText size={13} className="mt-0.5 shrink-0 text-accent" />
                <span className="[overflow-wrap:anywhere]">{note}</span>
              </div>
            )}
            {exercises.length === 0 ? <p className="py-6 text-center text-[11px] text-muted">Pick a routine to preview it.</p> : <ExerciseRows exercises={exercises} compact />}
          </div>
          <div className="border-t border-line p-3">
            <div className="rounded-xl bg-accent py-2 text-center text-xs font-bold text-on-accent">Start workout</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Each exercise with what to do ("3 × 8–10 · 40 kg"). */
export function ExerciseRows({ exercises, compact = false }: { exercises: TemplateExercise[]; compact?: boolean }) {
  const { exMap, unit } = useViewer();
  return (
    <ul className={cn("space-y-1.5", compact && "space-y-1")}>
      {exercises.map((te, i) => {
        const ex = exMap.get(te.exerciseId);
        return (
          <li key={`${te.exerciseId}-${i}`} className={cn("flex items-start justify-between gap-3 rounded-lg border border-line bg-field/50", compact ? "px-2 py-1.5" : "px-3 py-2")}>
            <div className="min-w-0">
              <div className={cn("truncate font-semibold", compact ? "text-[11px]" : "text-sm")}>{ex?.name ?? "Exercise"}</div>
              {te.notes && <div className={cn("line-clamp-2 text-muted [overflow-wrap:anywhere]", compact ? "text-[10px]" : "text-xs")}>{te.notes}</div>}
            </div>
            <div className={cn("shrink-0 text-right font-semibold tabular-nums text-muted", compact ? "text-[10px]" : "text-xs")}>{describePlan(te, ex, unit)}</div>
          </li>
        );
      })}
    </ul>
  );
}
