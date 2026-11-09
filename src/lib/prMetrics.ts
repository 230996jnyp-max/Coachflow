import type { PRKind, TrackingColumn, TrackingSchema, WorkoutSet } from "./types";

/*
 * Personal records for sport drills with their own set columns (see tracking.ts). Each schema is read for the numbers that matter in
 * that sport: a hold's length, rounds and round length, the pace for a swim distance, shooting accuracy and makes, or (for any custom
 * format) the one value the coach chose to chart. Pure functions, shared by the app and the server.
 */

export interface PrMetric {
  /** Which record this is (also the badge's name). */
  kind: PRKind;
  better: "high" | "low";
  /** The value of one set, and what it must be compared against (same side, same distance and stroke ...). Undefined: this set doesn't count. */
  read: (custom: Record<string, number | string>) => { value: number; group: string } | undefined;
}

const n = (v: number | string | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const s = (v: number | string | undefined): string => (typeof v === "string" ? v : "");
const has = (schema: TrackingSchema, key: string, kind?: TrackingColumn["kind"]) => schema.columns.some((c) => c.key === key && (!kind || c.kind === kind));

/** A shooting percentage only counts once there were enough attempts, so 1 from 1 isn't a record. */
export const MIN_ATTEMPTS = 10;

/** Words that mean "lower is better" in a column the coach named themselves. */
const LOWER_IS_BETTER = /(pace|split|time to|seconds? per|sec\/|\/100|\/km|lap time|reaction)/i;

export function metricsFor(schema: TrackingSchema): PrMetric[] {
  const out: PrMetric[] = [];
  const side = (c: Record<string, number | string>) => s(c.side) || "";

  // Holds (mobility, yoga): the longest hold, kept separately for each side.
  if (has(schema, "hold", "duration")) out.push({ kind: "HOLD", better: "high", read: (c) => (n(c.hold) ? { value: n(c.hold)!, group: side(c) } : undefined) });

  // Repetitions per side (mobility, yoga, drills): the most reps in one set, per side.
  if (has(schema, "reps", "number") && schema.primary === "reps") out.push({ kind: "REPS", better: "high", read: (c) => (n(c.reps) ? { value: n(c.reps)!, group: side(c) } : undefined) });

  // Rounds (boxing, combat, conditioning flows).
  if (has(schema, "rounds", "number")) {
    out.push({ kind: "ROUNDS", better: "high", read: (c) => (n(c.rounds) ? { value: n(c.rounds)!, group: "" } : undefined) });
    if (has(schema, "round_time", "duration")) out.push({ kind: "ROUND_TIME", better: "high", read: (c) => (n(c.round_time) ? { value: n(c.round_time)!, group: "" } : undefined) });
  }

  // Swimming: the fastest pace for the same distance and stroke, and the longest distance.
  if (has(schema, "distance", "number") && has(schema, "time", "duration") && has(schema, "stroke", "select")) {
    out.push({
      kind: "PACE",
      better: "low",
      read: (c) => {
        const d = n(c.distance);
        const t = n(c.time);
        return d && t ? { value: (t / d) * 100, group: `${d}|${s(c.stroke)}` } : undefined;
      },
    });
    out.push({ kind: "DISTANCE", better: "high", read: (c) => (n(c.distance) ? { value: n(c.distance)!, group: s(c.stroke) } : undefined) });
  }

  // Shooting: accuracy (with a minimum number of attempts) and the most makes in one drill.
  if (has(schema, "made", "number") && has(schema, "attempted", "number")) {
    out.push({
      kind: "ACCURACY",
      better: "high",
      read: (c) => {
        const m = n(c.made);
        const a = n(c.attempted);
        return m !== undefined && a !== undefined && a >= MIN_ATTEMPTS ? { value: (m / a) * 100, group: "" } : undefined;
      },
    });
    out.push({ kind: "MAKES", better: "high", read: (c) => (n(c.made) ? { value: n(c.made)!, group: "" } : undefined) });
  }

  // Anything else (a custom format, or a preset not covered above): the one value chosen for the progress chart.
  if (out.length === 0) {
    const col = schema.columns.find((c) => c.key === schema.primary);
    if (col && (col.kind === "number" || col.kind === "duration" || col.kind === "computed")) {
      const lower = col.op === "per100" || LOWER_IS_BETTER.test(`${col.label} ${col.unit ?? ""} ${col.key}`) || (col.kind === "duration" && col.agg === "avg" && has(schema, "reps"));
      out.push({
        kind: "METRIC",
        better: lower ? "low" : "high",
        read: (c) => {
          const v = col.kind === "computed" ? computed(col, c) : n(c[col.key]);
          return v !== undefined && v > 0 ? { value: v, group: side(c) } : undefined;
        },
      });
    }
  }
  return out;
}

/** The value of a calculated column for one set (a small copy of tracking.ts computeCol, kept here so this file stands alone). */
function computed(col: TrackingColumn, c: Record<string, number | string>): number | undefined {
  const vals = (col.of ?? []).map((k) => n(c[k]));
  if (!col.op || vals.length < 1 || vals.some((v) => v === undefined)) return undefined;
  const [a, b] = vals as number[];
  switch (col.op) {
    case "ratio_pct":
      return b ? (a / b) * 100 : undefined;
    case "ratio":
      return b ? a / b : undefined;
    case "per100":
      return b ? (a / b) * 100 : undefined;
    case "sum":
      return (vals as number[]).reduce((x, y) => x + y, 0);
    case "avg":
      return (vals as number[]).reduce((x, y) => x + y, 0) / vals.length;
    case "product":
      return (vals as number[]).reduce((x, y) => x * y, 1);
  }
}

/** Does this finished set beat the best so far? Updates `bests` (key: kind|group). Returns the records it set. */
export function checkSetMetrics(set: WorkoutSet, metrics: PrMetric[], bests: Map<string, number>): PRKind[] {
  const flags: PRKind[] = [];
  const custom = set.custom ?? {};
  for (const m of metrics) {
    const r = m.read(custom);
    if (!r) continue;
    const key = `${m.kind}|${r.group}`;
    const best = bests.get(key);
    const beats = best === undefined ? false : m.better === "high" ? r.value > best + 1e-9 : r.value < best - 1e-9;
    if (beats && !flags.includes(m.kind)) flags.push(m.kind);
    if (best === undefined || (m.better === "high" ? r.value > best : r.value < best)) bests.set(key, r.value);
  }
  return flags;
}
