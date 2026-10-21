"use client";

import { format, parseISO } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, ConfirmDialog, Field, IconButton, Input, Modal, SectionTitle, Segmented, Stat } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { useNow, addMetric, deleteMetric } from "@/lib/store";
import type { BodyMetricLog } from "@/lib/types";
import { fmtLength, fmtWeight, fromCm, fromKg, lengthUnit, round, toCm, toKg, weightUnit } from "@/lib/utils";
import { ymd } from "@/lib/scheduling";
import { axisProps, C, ChartBox, ChartEmpty, RANGES, rangeStart, tooltipStyle, type Range } from "./chartKit";

type Circ = "chest" | "waist" | "hips" | "arm" | "thigh" | "calves";
const CIRC: { key: Circ; label: string; color: string }[] = [
  { key: "waist", label: "Waist", color: C.accent },
  { key: "chest", label: "Chest", color: C.success },
  { key: "hips", label: "Hips", color: C.pr },
  { key: "arm", label: "Arm", color: C.purple },
  { key: "thigh", label: "Thigh", color: "#F472B6" },
  { key: "calves", label: "Calves", color: "#22D3EE" },
];

function circValue(m: BodyMetricLog, k: Circ): number | undefined {
  switch (k) {
    case "chest":
      return m.chest;
    case "waist":
      return m.waist;
    case "hips":
      return m.hips;
    case "calves":
      return m.calves;
    case "arm":
      return m.armR ?? m.armL;
    case "thigh":
      return m.thighR ?? m.thighL;
  }
}

export function BodyTab({ clientId }: { clientId: string }) {
  const { db, unit, user } = useViewer();
  const now = useNow(60_000);
  const [range, setRange] = useState<Range>("All");
  const [adding, setAdding] = useState(false);
  const [del, setDel] = useState<BodyMetricLog | null>(null);
  const [lines, setLines] = useState<Circ[]>(["waist", "chest"]);
  const wu = weightUnit(unit);
  const lu = lengthUnit(unit);

  const logs = useMemo(
    () => db.metrics.filter((m) => m.clientId === clientId).sort((a, b) => a.date.localeCompare(b.date)),
    [db.metrics, clientId],
  );
  const since = rangeStart(range, now);
  const visible = logs.filter((m) => parseISO(m.date).getTime() >= since);
  const withWeight = logs.filter((m) => m.weightKg !== undefined);
  const first = withWeight[0];
  const last = withWeight[withWeight.length - 1];
  const delta = first && last ? last.weightKg! - first.weightKg! : 0;
  const waists = logs.filter((m) => m.waist !== undefined);
  const waistDelta = waists.length > 1 ? waists[waists.length - 1].waist! - waists[0].waist! : 0;
  const lastBf = [...logs].reverse().find((m) => m.bodyFat !== undefined);

  const weightData = visible
    .filter((m) => m.weightKg !== undefined)
    .map((m) => ({ label: format(parseISO(m.date), "d MMM"), weight: round(fromKg(m.weightKg!, unit), 1) }));
  const compData = visible
    .filter((m) => m.bodyFat !== undefined || m.muscleMassKg !== undefined)
    .map((m) => ({
      label: format(parseISO(m.date), "d MMM"),
      bf: m.bodyFat,
      muscle: m.muscleMassKg !== undefined ? round(fromKg(m.muscleMassKg, unit), 1) : undefined,
    }));
  const circData = visible
    .filter((m) => CIRC.some((c) => circValue(m, c.key) !== undefined))
    .map((m) => {
      const row: Record<string, number | string | undefined> = { label: format(parseISO(m.date), "d MMM") };
      for (const c of CIRC) {
        const v = circValue(m, c.key);
        row[c.key] = v === undefined ? undefined : round(fromCm(v, unit), 1);
      }
      return row;
    });

  if (!user) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={range} onChange={setRange} options={RANGES} />
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} /> Log check-in
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Body weight" value={last ? fmtWeight(last.weightKg, unit) : "—"} tone="accent" sub={last ? format(parseISO(last.date), "d MMM yyyy") : undefined} />
        <Stat
          label="Change since start"
          value={first && last ? `${delta > 0 ? "+" : ""}${round(fromKg(delta, unit), 1)} ${wu}` : "—"}
          tone={delta === 0 ? undefined : "success"}
          sub={first ? `from ${fmtWeight(first.weightKg, unit)}` : undefined}
        />
        <Stat label="Body fat" value={lastBf ? `${lastBf.bodyFat}%` : "—"} />
        <Stat
          label="Waist change"
          value={waists.length > 1 ? `${waistDelta > 0 ? "+" : ""}${round(fromCm(waistDelta, unit), 1)} ${lu}` : "—"}
          sub={waists.length ? `now ${fmtLength(waists[waists.length - 1].waist, unit)}` : undefined}
        />
      </div>

      {logs.length === 0 ? (
        <ChartEmpty message="No check-ins yet. Log body weight and measurements to start tracking." />
      ) : (
        <>
          <section>
            <SectionTitle>Body weight ({wu})</SectionTitle>
            <Card className="p-3 pt-5">
              {weightData.length < 2 ? (
                <ChartEmpty />
              ) : (
                <ChartBox>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weightData} margin={{ left: -10, right: 8 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                      <YAxis {...axisProps} domain={["dataMin - 1", "dataMax + 1"]} tickFormatter={(v) => String(round(v, 1))} />
                      <Tooltip {...tooltipStyle} formatter={(v) => [`${v} ${wu}`, "Weight"]} />
                      {first && <ReferenceLine y={round(fromKg(first.weightKg!, unit), 1)} stroke={C.axis} strokeDasharray="4 4" label={{ value: "Start", fill: C.axis, fontSize: 10, position: "insideTopLeft" }} />}
                      <Line dataKey="weight" stroke={C.accent} strokeWidth={2.5} dot={{ r: 3, fill: C.accent }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartBox>
              )}
            </Card>
          </section>

          <section>
            <SectionTitle>Body composition</SectionTitle>
            <Card className="p-3 pt-5">
              {compData.length < 2 ? (
                <ChartEmpty message="Log body fat % or muscle mass to chart composition." />
              ) : (
                <ChartBox height={240}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={compData} margin={{ left: -10, right: -6 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                      <YAxis yAxisId="l" {...axisProps} domain={["dataMin - 1", "dataMax + 1"]} tickFormatter={(v) => String(Math.round(v))} />
                      <YAxis yAxisId="r" orientation="right" {...axisProps} domain={["dataMin - 1", "dataMax + 1"]} tickFormatter={(v) => String(Math.round(v))} />
                      <Tooltip {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12, color: C.axis }} />
                      <Line yAxisId="l" dataKey="bf" name="Body fat %" stroke={C.pr} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                      <Line yAxisId="r" dataKey="muscle" name={`Muscle (${wu})`} stroke={C.success} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartBox>
              )}
            </Card>
          </section>

          <section>
            <SectionTitle>Measurements ({lu})</SectionTitle>
            <Card className="space-y-4 p-4">
              <div className="flex flex-wrap gap-1.5">
                {CIRC.map((c) => {
                  const on = lines.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      onClick={() => setLines((l) => (on ? l.filter((x) => x !== c.key) : [...l, c.key]))}
                      className="min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors"
                      style={on ? { borderColor: c.color, background: c.color + "26", color: c.color } : { borderColor: "#262E40", color: "#8892A6" }}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {circData.length < 2 || lines.length === 0 ? (
                <ChartEmpty message={lines.length === 0 ? "Select at least one measurement." : "Log measurements on at least two dates."} />
              ) : (
                <ChartBox height={240}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={circData} margin={{ left: -10, right: 8 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                      <YAxis {...axisProps} domain={["dataMin - 2", "dataMax + 2"]} tickFormatter={(v) => String(Math.round(v))} />
                      <Tooltip {...tooltipStyle} formatter={(v, n) => [`${v} ${lu}`, n]} />
                      {CIRC.filter((c) => lines.includes(c.key)).map((c) => (
                        <Line key={c.key} dataKey={c.key} name={c.label} stroke={c.color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartBox>
              )}
            </Card>
          </section>

          <section>
            <SectionTitle>Check-in history</SectionTitle>
            <div className="space-y-2">
              {[...logs].reverse().slice(0, 12).map((m) => (
                <Card key={m.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{format(parseISO(m.date), "EEE d MMM yyyy")}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                      {m.weightKg !== undefined && <span>{fmtWeight(m.weightKg, unit)}</span>}
                      {m.bodyFat !== undefined && <span>{m.bodyFat}% fat</span>}
                      {m.waist !== undefined && <span>Waist {fmtLength(m.waist, unit)}</span>}
                      {m.chest !== undefined && <span>Chest {fmtLength(m.chest, unit)}</span>}
                    </div>
                  </div>
                  <Badge>{m.loggedBy === "TRAINER" ? "Trainer" : "Client"}</Badge>
                  <IconButton label="Delete check-in" onClick={() => setDel(m)}>
                    <Trash2 size={16} />
                  </IconButton>
                </Card>
              ))}
            </div>
          </section>
        </>
      )}

      {adding && <CheckInModal clientId={clientId} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        danger
        title="Delete check-in?"
        message={del ? `The ${format(parseISO(del.date), "d MMM yyyy")} entry will be removed.` : ""}
        confirmLabel="Delete"
        onConfirm={() => del && deleteMetric(del.id)}
      />
    </div>
  );
}

function CheckInModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { user, unit } = useViewer();
  const wu = weightUnit(unit);
  const lu = lengthUnit(unit);
  const [date, setDate] = useState(() => ymd(new Date()));
  const [v, setV] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const num = (k: string) => {
    const n = parseFloat(v[k] ?? "");
    return Number.isNaN(n) ? undefined : n;
  };
  const kg = (k: string) => (num(k) === undefined ? undefined : round(toKg(num(k)!, unit), 2));
  const cm = (k: string) => (num(k) === undefined ? undefined : round(toCm(num(k)!, unit), 1));
  const any = ["weight", "bf", "muscle", "chest", "waist", "hips", "armL", "armR", "thighL", "thighR", "calves"].some((k) => num(k) !== undefined);

  const field = (k: string, label: string, unitLabel: string) => (
    <Field label={`${label} (${unitLabel})`}>
      <Input type="number" inputMode="decimal" step="0.1" value={v[k] ?? ""} onChange={set(k)} className="h-10" />
    </Field>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Log body check-in"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!any || !user}
            onClick={() => {
              addMetric({
                clientId,
                date,
                weightKg: kg("weight"),
                bodyFat: num("bf"),
                muscleMassKg: kg("muscle"),
                chest: cm("chest"),
                waist: cm("waist"),
                hips: cm("hips"),
                armL: cm("armL"),
                armR: cm("armR"),
                thighL: cm("thighL"),
                thighR: cm("thighR"),
                calves: cm("calves"),
                loggedBy: user!.role,
              });
              onClose();
            }}
          >
            Save check-in
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Date">
          <Input type="date" value={date} max={ymd(new Date())} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {field("weight", "Body weight", wu)}
          {field("bf", "Body fat", "%")}
          {field("muscle", "Skeletal muscle", wu)}
        </div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Circumference ({lu})</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {field("chest", "Chest", lu)}
          {field("waist", "Waist", lu)}
          {field("hips", "Hips", lu)}
          {field("armL", "Left arm", lu)}
          {field("armR", "Right arm", lu)}
          {field("calves", "Calves", lu)}
          {field("thighL", "Left thigh", lu)}
          {field("thighR", "Right thigh", lu)}
        </div>
      </div>
    </Modal>
  );
}
