"use client";

import { ChevronDown, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useAiNote } from "@/lib/aiNote";
import { formatSet } from "@/lib/stats";
import type { SetTarget, Suggestion } from "@/lib/progression";
import type { Exercise, UnitSystem, WorkoutSet } from "@/lib/types";
import { cn } from "@/lib/utils";

/** How a target reads in the pill, e.g. "62.5 kg × 8" or "Made 8 · Attempted 10". */
export function targetText(t: SetTarget | undefined, ex: Exercise, unit: UnitSystem): string {
  if (!t) return "";
  const set: WorkoutSet = { id: "x", type: "N", done: false, ...t };
  return formatSet(set, ex, unit);
}

/**
 * Above an exercise's sets: what to aim for today (a step up, a repeat, or an amber deload) with one tap to fill every empty set,
 * and a "Why?" that explains it (the rule's wording first, plus a short AI sentence when the AI is available).
 */
export function SuggestionBar({ ex, sug, unit, onApplyAll }: { ex: Exercise; sug: Suggestion; unit: UnitSystem; onApplyAll: () => void }) {
  const [why, setWhy] = useState(false);
  const note = useAiNote("why", sug.facts, why);
  const deload = sug.kind === "DELOAD";
  const first = targetText(sug.sets[0], ex, unit);
  return (
    <div className={cn("mb-2 rounded-xl border px-3 py-2", deload ? "border-pr/40 bg-pr/10" : "border-accent/30 bg-accent/5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          {deload ? (
            <span className="inline-flex items-center gap-1.5 font-bold text-pr">
              <Zap size={15} /> Deload Suggested (-10% load / volume)
            </span>
          ) : (
            <span className="font-semibold text-accent">{sug.kind === "REPEAT" ? "Suggested today: repeat" : "Suggested today"}</span>
          )}
          {first && <span className="ml-2 text-muted">{first}</span>}
        </div>
        <Button size="sm" variant={deload ? "outline" : "secondary"} onClick={onApplyAll}>
          {deload ? "Apply deload" : "Apply all suggested targets"}
        </Button>
      </div>
      <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-muted hover:text-ink">
        Why? <ChevronDown size={13} className={cn("transition-transform", why && "rotate-180")} />
      </button>
      {why && (
        <div className="space-y-1 pb-1 text-xs text-muted">
          <p>{sug.reason}</p>
          {note && (
            <p className="flex items-start gap-1.5 text-ink">
              <Sparkles size={12} className="mt-0.5 shrink-0 text-accent" /> {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
