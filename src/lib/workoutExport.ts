import { format, parseISO } from "date-fns";
import { workoutSetCount, workoutVolume, type ExerciseMap } from "./stats";
import type { RoutineTemplate, UnitSystem, Workout, WorkoutSet } from "./types";
import { fmtDurationShort, fmtVolume, fromKg, round } from "./utils";

/*
 * Turns routines and logged workouts into a neutral document model that the PDF writer and the plain-text writer share.
 * The plain text is written in the same style the importer reads, so an export can be pasted straight back in.
 */

export interface ExportRow {
  name: string;
  sets: string;
  reps: string;
  weight: string;
  notes: string;
}

export interface ExportBlock {
  title: string;
  /** Short facts shown under the title (date, client, location…). */
  meta: { label: string; value: string }[];
  rows: ExportRow[];
  summary: string;
  notes?: string;
  /** Raw numbers for the text writer. */
  lines: string[];
}

export interface ExportDoc {
  brand: string;
  title: string;
  subtitle: string;
  blocks: ExportBlock[];
}

const wUnit = (u: UnitSystem) => (u === "metric" ? "kg" : "lb");
const num = (kg: number, u: UnitSystem) => round(fromKg(kg, u), 1);
const w = (kg: number, u: UnitSystem) => `${num(kg, u)}${wUnit(u)}`;
const wSpaced = (kg: number, u: UnitSystem) => `${num(kg, u)} ${wUnit(u)}`;
const mins = (sec: number) => {
  const m = Math.round(sec / 6) / 10;
  return `${m} min`;
};
const same = <T,>(a: T[]) => a.every((x) => x === a[0]);
const dash = "-";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function dur(sec?: number): string {
  if (!sec) return "";
  return sec < 120 ? `${Math.round(sec)} sec` : mins(sec);
}

/* ---------------- Routine templates ---------------- */
export function templateBlock(t: RoutineTemplate, exMap: ExerciseMap, unit: UnitSystem): ExportBlock {
  const rows: ExportRow[] = [];
  const lines: string[] = [];
  let sets = 0;
  for (const te of t.exercises) {
    const ex = exMap.get(te.exerciseId);
    const name = ex?.name ?? "Unknown exercise";
    const timed = ex?.type === "DURATION_DISTANCE" || ex?.type === "DURATION_ONLY";
    const range = te.repMin === te.repMax ? `${te.repMax}` : `${te.repMin}-${te.repMax}`;
    const hasReps = te.repMax > 0;
    if (timed) {
      const parts = [te.durationSec ? dur(te.durationSec) : "", te.distanceKm ? `${round(te.distanceKm, 2)} km` : ""].filter(Boolean);
      rows.push({ name, sets: te.sets > 1 ? String(te.sets) : dash, reps: parts.join(" · ") || dash, weight: dash, notes: te.notes ?? "" });
      const spec = [te.durationSec ? dur(te.durationSec).replace("sec", "s").replace(" min", " mins") : "", te.distanceKm ? `${round(te.distanceKm, 2)}km` : ""].filter(Boolean).join(" ");
      lines.push(`${name} - ${spec || "1 round"}`);
      sets += te.sets;
    } else {
      rows.push({ name, sets: String(te.sets), reps: hasReps ? range : dash, weight: te.weight ? wSpaced(te.weight, unit) : dash, notes: te.notes ?? "" });
      lines.push(`${name} - ${te.sets} x ${hasReps ? range : 10}${te.weight ? ` @ ${w(te.weight, unit)}` : ""}`);
      sets += te.sets;
    }
    if (te.notes) lines.push(`  Note: ${te.notes}`);
  }
  return {
    title: t.name,
    meta: [],
    rows,
    summary: `${plural(t.exercises.length, "exercise")} · ${plural(sets, "set")}`,
    lines,
  };
}

/* ---------------- Logged workouts ---------------- */
function describeSets(sets: WorkoutSet[], unit: UnitSystem, timed: boolean): { reps: string; weight: string; line: string } {
  if (timed) {
    const d = sets.map((s) => s.durationSec ?? 0);
    const km = sets.map((s) => s.distanceKm ?? 0);
    const totalDur = d.reduce((a, b) => a + b, 0);
    const totalKm = km.reduce((a, b) => a + b, 0);
    // Repeated holds ("Plank 3 x 45s") read better per set than as a total.
    if (sets.length > 1 && d[0] > 0 && same(d) && totalKm === 0) {
      const secs = Math.round(d[0]);
      return { reps: `${dur(secs)} each`, weight: dash, line: `${sets.length} x ${secs}s` };
    }
    const parts = [totalDur ? dur(totalDur) : "", totalKm ? `${round(totalKm, 2)} km` : ""].filter(Boolean);
    const line = [totalDur ? (totalDur < 120 ? `${Math.round(totalDur)}s` : `${Math.round(totalDur / 60)} mins`) : "", totalKm ? `${round(totalKm, 2)}km` : ""].filter(Boolean).join(" ");
    return { reps: parts.join(" · ") || dash, weight: dash, line: line || "1 round" };
  }
  const reps = sets.map((s) => s.reps ?? 0);
  const weights = sets.map((s) => s.weight ?? 0);
  const anyWeight = weights.some(Boolean);
  const repsText = same(reps) ? String(reps[0] || dash) : reps.join(" / ");
  const weightText = !anyWeight ? dash : same(weights) ? wSpaced(weights[0], unit) : `${weights.map((x) => num(x, unit)).join(" / ")} ${wUnit(unit)}`;
  let line: string;
  if (same(reps) && same(weights)) line = `${sets.length} x ${reps[0] || 10}${anyWeight ? ` @ ${w(weights[0], unit)}` : ""}`;
  else line = sets.map((s) => (s.weight ? `${w(s.weight, unit)} x ${s.reps ?? 0}` : `${s.reps ?? 0}`)).join(", ");
  return { reps: repsText, weight: weightText, line };
}

export function workoutBlock(wk: Workout, exMap: ExerciseMap, unit: UnitSystem, ctx: { clientName?: string; location?: string } = {}): ExportBlock {
  const rows: ExportRow[] = [];
  const lines: string[] = [];
  for (const we of wk.exercises) {
    const ex = exMap.get(we.exerciseId);
    const name = ex?.name ?? "Unknown exercise";
    const timed = ex?.type === "DURATION_DISTANCE" || ex?.type === "DURATION_ONLY";
    const working = we.sets.filter((s) => s.type !== "W" && s.done);
    const warm = we.sets.filter((s) => s.type === "W" && s.done).length;
    if (!working.length) continue;
    const d = describeSets(working, unit, timed);
    const pr = working.some((s) => s.pr?.length);
    const notes = [we.notes, pr ? "PR" : ""].filter(Boolean).join(" · ");
    rows.push({ name, sets: timed && working.length === 1 ? dash : `${working.length}${warm ? ` (+${warm} warm-up)` : ""}`, reps: d.reps, weight: d.weight, notes });
    lines.push(`${name} - ${d.line}`);
    if (we.notes) lines.push(`  Note: ${we.notes}`);
  }
  const meta: ExportBlock["meta"] = [{ label: "Date", value: format(parseISO(wk.startedAt), "EEE d MMM yyyy") }];
  if (ctx.clientName) meta.push({ label: "Client", value: ctx.clientName });
  if (ctx.location) meta.push({ label: "Location", value: ctx.location });
  const parts = [plural(rows.length, "exercise"), plural(workoutSetCount(wk), "set")];
  const vol = workoutVolume(wk, exMap);
  if (vol > 0) parts.push(`${fmtVolume(vol, unit)} volume`);
  if (wk.durationSec > 0) parts.push(fmtDurationShort(wk.durationSec));
  return { title: wk.title, meta, rows, summary: parts.join(" · "), notes: wk.notes || undefined, lines };
}

/* ---------------- Plain text (also valid input for the importer) ---------------- */
export function blocksToText(doc: ExportDoc): string {
  const out: string[] = [`// ${doc.brand} - ${doc.title}`, `// ${doc.subtitle}`, ""];
  for (const b of doc.blocks) {
    out.push(`# ${b.title}`);
    for (const m of b.meta) out.push(m.label === "Date" ? `Date: ${m.value.replace(/^[A-Za-z]{3} /, "")}` : `${m.label}: ${m.value}`);
    out.push(...b.lines);
    if (b.notes) out.push(`// Workout notes: ${b.notes.replace(/\s*\n\s*/g, " ")}`);
    out.push(`// ${b.summary}`, "");
  }
  return out.join("\n").trimEnd() + "\n";
}
