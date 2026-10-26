import { fmtClock } from "./utils";
import type { TrackingAgg, TrackingColumn, TrackingKind, TrackingOp, TrackingSchema, Workout, WorkoutSet } from "./types";

/*
 * Tracking formats for sport drills. An exercise can define its own set-table columns (e.g. Made / Attempted / Shooting %)
 * and which value to chart. Values live on the set (`WorkoutSet.custom[key]`): numbers (a duration is in seconds) or text.
 * Pure functions, shared by the app and the server (which re-validates everything the AI or a browser sends).
 */

const col = (key: string, label: string, kind: TrackingKind, extra: Partial<TrackingColumn> = {}): TrackingColumn => ({ key, label, kind, ...extra });
const SIDE = ["Both", "Left", "Right"];

/** Ready-made formats the seeded sport library uses (and the AI can pick from). */
export const TRACKING_PRESETS: Record<string, TrackingSchema> = {
  hold: { columns: [col("hold", "Hold", "duration", { agg: "max" })], primary: "hold" },
  hold_side: { columns: [col("hold", "Hold", "duration", { agg: "max" }), col("side", "Side", "select", { options: SIDE })], primary: "hold" },
  reps: { columns: [col("reps", "Reps", "number", { agg: "sum" })], primary: "reps" },
  reps_side: { columns: [col("reps", "Reps", "number", { agg: "sum" }), col("side", "Side", "select", { options: SIDE })], primary: "reps" },
  flow: { columns: [col("rounds", "Rounds", "number", { agg: "sum" }), col("time", "Time", "duration", { agg: "sum" })], primary: "rounds" },
  rounds: {
    columns: [
      col("rounds", "Rounds", "number", { agg: "sum" }),
      col("round_time", "Round", "duration", { agg: "avg" }),
      col("rest", "Rest", "duration", { agg: "avg" }),
      col("total_time", "Total time", "computed", { op: "product", of: ["rounds", "round_time"], agg: "sum" }),
    ],
    primary: "rounds",
  },
  swim: {
    columns: [
      col("stroke", "Stroke", "select", { options: ["Freestyle", "Breaststroke", "Backstroke", "Butterfly", "IM", "Kick"] }),
      col("distance", "Distance", "number", { unit: "m", agg: "sum" }),
      col("time", "Time", "duration", { agg: "sum" }),
      col("pace", "Pace", "computed", { op: "per100", of: ["time", "distance"], unit: "/100m" }),
    ],
    primary: "distance",
  },
  shooting: {
    columns: [
      col("spot", "Spot", "text"),
      col("made", "Made", "number", { agg: "sum" }),
      col("attempted", "Attempted", "number", { agg: "sum" }),
      col("pct", "Shooting %", "computed", { op: "ratio_pct", of: ["made", "attempted"] }),
    ],
    primary: "pct",
  },
  timed: { columns: [col("reps", "Reps", "number", { agg: "sum" }), col("time", "Time", "duration", { agg: "avg" })], primary: "time" },
  interval: { columns: [col("reps", "Reps", "number", { agg: "sum" }), col("distance", "Distance", "number", { unit: "m", agg: "sum" }), col("time", "Time", "duration", { agg: "avg" })], primary: "distance" },
};

export const PRESET_IDS = Object.keys(TRACKING_PRESETS);

const KINDS: TrackingKind[] = ["number", "duration", "text", "select", "computed"];
const OPS: TrackingOp[] = ["ratio_pct", "ratio", "per100", "sum", "avg", "product"];
const AGGS: TrackingAgg[] = ["sum", "max", "avg", "last"];
const PAIR_OPS: TrackingOp[] = ["ratio_pct", "ratio", "per100"];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
const isNumeric = (c: TrackingColumn) => c.kind === "number" || c.kind === "duration";
export const isChartable = (c: TrackingColumn) => c.kind === "number" || c.kind === "duration" || c.kind === "computed";

export type TrackingResult = { ok: true; schema: TrackingSchema } | { ok: false; error: string };

/**
 * Rebuilds a tracking schema from untrusted input (the AI, or a browser), field by field. Fixes small slips (keys made from the
 * label, unknown aggregation) and rejects anything that can't work.
 */
export function sanitizeTracking(raw: unknown): TrackingResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "No tracking format." };
  const r = raw as Record<string, unknown>;
  if (typeof r.preset === "string" && TRACKING_PRESETS[r.preset]) return { ok: true, schema: structuredClone(TRACKING_PRESETS[r.preset]) };
  if (!Array.isArray(r.columns) || r.columns.length === 0) return { ok: false, error: "The tracking format needs at least one column." };

  const columns: TrackingColumn[] = [];
  const rename = new Map<string, string>(); // what the input called a column -> its clean key
  const used = new Set<string>();
  for (const item of r.columns.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const label = typeof c.label === "string" ? c.label.replace(/\s+/g, " ").trim().slice(0, 28) : "";
    const kind = KINDS.includes(c.kind as TrackingKind) ? (c.kind as TrackingKind) : undefined;
    if (!label || !kind) continue;
    let key = slug(typeof c.key === "string" && c.key ? c.key : label) || "col";
    if (/^\d/.test(key)) key = `c_${key}`;
    for (let n = 2; used.has(key); n++) key = `${key.replace(/_\d+$/, "")}_${n}`;
    used.add(key);
    if (typeof c.key === "string") rename.set(c.key, key);
    rename.set(label, key);
    const out: TrackingColumn = { key, label, kind };
    if (typeof c.unit === "string" && c.unit.trim()) out.unit = c.unit.trim().slice(0, 12);
    if (kind === "select") {
      const options = Array.isArray(c.options) ? [...new Set(c.options.filter((o): o is string => typeof o === "string").map((o) => o.trim().slice(0, 20)).filter(Boolean))].slice(0, 8) : [];
      if (options.length >= 2) out.options = options;
      else out.kind = "text";
    }
    if (kind === "computed") {
      out.op = OPS.includes(c.op as TrackingOp) ? (c.op as TrackingOp) : undefined;
      out.of = Array.isArray(c.of) ? c.of.filter((o): o is string => typeof o === "string").map((o) => rename.get(o) ?? slug(o)) : [];
    }
    if (AGGS.includes(c.agg as TrackingAgg)) out.agg = c.agg as TrackingAgg;
    columns.push(out);
  }

  // Computed columns may only use number / duration columns, with the right number of inputs.
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const valid = columns.filter((c) => {
    if (c.kind !== "computed") return true;
    if (!c.op || !c.of) return false;
    if (c.of.some((k) => !byKey.get(k) || !isNumeric(byKey.get(k)!))) return false;
    return PAIR_OPS.includes(c.op) ? c.of.length === 2 : c.of.length >= 2 && c.of.length <= 4;
  });
  if (valid.length === 0) return { ok: false, error: "The tracking format has no usable columns." };
  const chartable = valid.filter(isChartable);
  if (chartable.length === 0) return { ok: false, error: "At least one column must be a number, a time or a calculation." };

  const wanted = typeof r.primary === "string" ? (rename.get(r.primary) ?? slug(r.primary)) : "";
  const primary = chartable.find((c) => c.key === wanted)?.key ?? chartable[0].key;
  return { ok: true, schema: { columns: valid, primary } };
}

/* ---------------- Values ---------------- */
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** The value of a "computed" column for one set (undefined until every input is filled in). */
export function computeCol(c: TrackingColumn, custom: WorkoutSet["custom"]): number | undefined {
  if (c.kind !== "computed" || !c.op || !c.of) return undefined;
  const v = c.of.map((k) => num(custom?.[k]));
  if (v.some((x) => x === undefined)) return undefined;
  const [a, b] = v as number[];
  switch (c.op) {
    case "ratio_pct":
      return b > 0 ? round((a / b) * 100, 1) : undefined;
    case "ratio":
      return b > 0 ? round(a / b, 2) : undefined;
    case "per100":
      return b > 0 ? round((a / b) * 100, 1) : undefined;
    case "sum":
      return round((v as number[]).reduce((s, x) => s + x, 0), 2);
    case "avg":
      return round((v as number[]).reduce((s, x) => s + x, 0) / v.length, 2);
    case "product":
      return round((v as number[]).reduce((s, x) => s * x, 1), 2);
  }
}

export function formatValue(c: TrackingColumn, v: number | string | undefined): string {
  if (v === undefined || v === "") return "";
  if (typeof v === "string") return v;
  if (c.kind === "duration") return fmtClock(v);
  if (c.kind === "computed") {
    if (c.op === "ratio_pct") return `${v}%`;
    if (c.op === "per100") return `${fmtClock(v)}${c.unit ? ` ${c.unit}` : ""}`;
    if (c.of?.length && c.op === "product") return v >= 60 ? fmtClock(v) : `${v}`; // e.g. rounds x minutes
  }
  return `${v}${c.unit ? ` ${c.unit}` : ""}`;
}

/** A set as a short line, e.g. "Made 7 · Attempted 10 · 70%". */
export function formatCustomSet(set: WorkoutSet | undefined, schema: TrackingSchema): string {
  if (!set) return "—";
  const parts: string[] = [];
  for (const c of schema.columns) {
    const raw = c.kind === "computed" ? computeCol(c, set.custom) : set.custom?.[c.key];
    const text = formatValue(c, raw);
    if (!text) continue;
    parts.push(c.kind === "select" || c.kind === "text" || c.kind === "computed" ? text : `${c.label} ${text}`);
  }
  return parts.length ? parts.join(" · ") : "—";
}

/** One-line description of a format, e.g. "Spot · Made · Attempted · Shooting %". */
export const describeSchema = (schema: TrackingSchema) => schema.columns.map((c) => c.label).join(" · ");

/* ---------------- Progress ---------------- */
export interface TrackingPoint {
  date: string;
  ts: number;
  /** Chartable column key -> value for the whole session. */
  values: Record<string, number>;
}

function combine(list: number[], agg: TrackingAgg): number {
  switch (agg) {
    case "max":
      return Math.max(...list);
    case "avg":
      return list.reduce((s, x) => s + x, 0) / list.length;
    case "last":
      return list[list.length - 1];
    default:
      return list.reduce((s, x) => s + x, 0);
  }
}

/** One point per finished workout: each number / time / calculation column combined over that session's sets. */
export function trackingPoints(workouts: Workout[], exerciseId: string, schema: TrackingSchema): TrackingPoint[] {
  const out: TrackingPoint[] = [];
  for (const w of [...workouts].filter((x) => x.status === "DONE").sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const sets = w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter((s) => s.done && s.type !== "W"));
    if (!sets.length) continue;
    const values: Record<string, number> = {};
    for (const c of schema.columns) {
      if (c.kind === "number" || c.kind === "duration") {
        const list = sets.map((s) => num(s.custom?.[c.key])).filter((x): x is number => x !== undefined);
        if (list.length) values[c.key] = round(combine(list, c.agg ?? "sum"), 2);
      } else if (c.kind === "computed" && c.op && c.of) {
        if (PAIR_OPS.includes(c.op)) {
          // A ratio over the whole session (all made / all attempted), not an average of per-set ratios.
          let a = 0;
          let b = 0;
          for (const s of sets) {
            const x = num(s.custom?.[c.of[0]]);
            const y = num(s.custom?.[c.of[1]]);
            if (x !== undefined && y !== undefined) {
              a += x;
              b += y;
            }
          }
          if (b > 0) values[c.key] = round(c.op === "ratio" ? a / b : (a / b) * 100, c.op === "ratio" ? 2 : 1);
        } else {
          const list = sets.map((s) => computeCol(c, s.custom)).filter((x): x is number => x !== undefined);
          if (list.length) values[c.key] = round(combine(list, c.agg ?? "sum"), 2);
        }
      }
    }
    if (Object.keys(values).length) out.push({ date: w.startedAt, ts: Date.parse(w.startedAt), values });
  }
  return out;
}

/* ---------------- Helpers for the screens ---------------- */
/** Friendly names for the presets (the exercise creator's "tracking format" list). */
export const PRESET_LABELS: Record<string, string> = {
  hold: "Hold time",
  hold_side: "Hold time per side",
  reps: "Reps only",
  reps_side: "Reps per side",
  flow: "Rounds + time",
  rounds: "Rounds + round length + rest",
  swim: "Swim set (distance, time, pace)",
  shooting: "Shooting (made / attempted / %)",
  timed: "Timed drill (reps + time)",
  interval: "Intervals (distance + time)",
};

/** The classic measure type to store alongside a custom format (used wherever a simple type is needed). */
export const fallbackType = (schema: TrackingSchema): "DURATION_ONLY" | "BODYWEIGHT_REPS" => (schema.columns.find((c) => c.key === schema.primary)?.kind === "duration" ? "DURATION_ONLY" : "BODYWEIGHT_REPS");

/** Has the person entered anything that counts for a set of this format (a number or a time)? */
export function hasTrackedValue(set: WorkoutSet, schema: TrackingSchema): boolean {
  return schema.columns.some((c) => (c.kind === "number" || c.kind === "duration") && typeof set.custom?.[c.key] === "number");
}
