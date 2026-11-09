import { format, parseISO } from "date-fns";
import { PR_LABELS, workoutSetCount, workoutVolume, type ExerciseMap } from "./stats";
import { sportLabel } from "./sports";
import type { UnitSystem, Workout } from "./types";
import { fmtDurationShort, fmtVolume } from "./utils";

/*
 * The post-workout recap: one object that the on-screen card, the WhatsApp text, the picture / PDF and the email are all made from,
 * so they always say the same thing. Pure functions, shared by the app and the server.
 */

export interface RecapPr {
  exercise: string;
  records: string[];
}

export interface Recap {
  brand: string;
  clientName: string;
  title: string;
  /** e.g. "Fri 30 Oct 2026" */
  date: string;
  duration: string;
  focus: string[];
  exercises: number;
  sets: number;
  volume: string;
  prs: RecapPr[];
  notes: string;
  credits: { oneOnOne: number; group: number } | null;
}

export interface RecapContext {
  brand: string;
  clientName: string;
  focuses: string[];
  credits: { oneOnOne: number; group: number } | null;
  unit: UnitSystem;
}

export function buildRecap(w: Workout, exMap: ExerciseMap, ctx: RecapContext): Recap {
  const prs: RecapPr[] = [];
  for (const we of w.exercises) {
    const records = [...new Set(we.sets.flatMap((s) => (s.pr ?? []).map((p) => PR_LABELS[p])))];
    if (records.length) prs.push({ exercise: exMap.get(we.exerciseId)?.name ?? "Exercise", records });
  }
  const volume = workoutVolume(w, exMap);
  return {
    brand: ctx.brand,
    clientName: ctx.clientName,
    title: w.title || "Workout",
    date: format(parseISO(w.startedAt), "EEE d MMM yyyy"),
    duration: w.durationSec > 0 ? fmtDurationShort(w.durationSec) : "",
    focus: ctx.focuses.map(sportLabel),
    exercises: w.exercises.filter((we) => we.sets.some((s) => s.done)).length,
    sets: workoutSetCount(w),
    volume: volume > 0 ? fmtVolume(volume, ctx.unit) : "",
    prs,
    notes: w.notes.trim(),
    credits: ctx.credits,
  };
}

/** Emoji-formatted plain text, ready to paste into WhatsApp or a chat. */
export function recapText(r: Recap): string {
  const lines: string[] = [];
  lines.push(`🏋️ *${r.title}*${r.clientName ? ` — ${r.clientName}` : ""}`);
  lines.push(`📅 ${r.date}${r.duration ? ` · ⏱️ ${r.duration}` : ""}`);
  if (r.focus.length) lines.push(`🎯 ${r.focus.join(", ")}`);
  lines.push("");
  lines.push(`✅ ${r.exercises} exercise${r.exercises === 1 ? "" : "s"} · ${r.sets} set${r.sets === 1 ? "" : "s"}${r.volume ? ` · ${r.volume} total` : ""}`);
  if (r.prs.length) {
    lines.push("");
    lines.push(`🏆 New PR${r.prs.length === 1 ? "" : "s"} today:`);
    for (const p of r.prs) lines.push(`• ${p.exercise} — ${p.records.join(", ")}`);
  }
  if (r.notes) {
    lines.push("");
    lines.push(`📝 ${r.notes}`);
  }
  if (r.credits) {
    lines.push("");
    lines.push(`🎟️ Sessions left: ${r.credits.oneOnOne}${r.credits.group ? ` · group classes left: ${r.credits.group}` : ""}`);
  }
  lines.push("");
  lines.push(`— ${r.brand}`);
  return lines.join("\n");
}
