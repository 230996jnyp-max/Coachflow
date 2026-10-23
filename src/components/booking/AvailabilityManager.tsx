"use client";

import { format, parseISO } from "date-fns";
import { Lock, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Card, Field, IconButton, Input, Notice, SectionTitle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { ymd } from "@/lib/scheduling";
import { addSlot, deleteSlot } from "@/lib/store";
import type { AvailabilitySlot } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 0, label: "Sun" },
];

export function AvailabilityManager() {
  const { db } = useViewer();
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("20:00");
  const [oneDate, setOneDate] = useState(() => ymd(new Date()));
  const [oneStart, setOneStart] = useState("09:00");
  const [oneEnd, setOneEnd] = useState("12:00");
  const [blkDate, setBlkDate] = useState(() => ymd(new Date()));
  const [blkStart, setBlkStart] = useState("12:00");
  const [blkEnd, setBlkEnd] = useState("13:00");
  const [blkLabel, setBlkLabel] = useState("Personal time");
  const [error, setError] = useState<string | null>(null);
  const report = async (p: Promise<string | null>) => {
    const e = await p;
    if (e) setError(e);
  };

  const recurring = db.slots.filter((s) => s.kind === "RECURRING");
  const oneOffs = db.slots.filter((s) => s.kind === "ONE_OFF").sort((a, b) => (a.date! + a.start).localeCompare(b.date! + b.start));
  const blocks = db.slots.filter((s) => s.kind === "BLOCK").sort((a, b) => (a.date! + a.start).localeCompare(b.date! + b.start));

  const validate = (s: string, e: string) => {
    if (!s || !e || s >= e) {
      setError("End time must be after the start time.");
      return false;
    }
    setError(null);
    return true;
  };

  return (
    <div className="space-y-8">
      {error && <Notice tone="error">{error}</Notice>}

      <section>
        <SectionTitle>Weekly availability</SectionTitle>
        <Card className="space-y-4 p-4">
          <div className="space-y-2">
            {DAYS.map((d) => {
              const rows = recurring.filter((s) => s.weekday === d.n).sort((a, b) => a.start.localeCompare(b.start));
              return (
                <div key={d.n} className="flex items-start gap-3 border-b border-line pb-2 last:border-0">
                  <div className="w-12 pt-2 text-sm font-bold">{d.label}</div>
                  <div className="flex flex-1 flex-wrap gap-2">
                    {rows.length === 0 && <span className="pt-2 text-xs text-muted">Unavailable</span>}
                    {rows.map((r) => (
                      <Chip key={r.id} slot={r} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rounded-xl border border-line bg-field p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Add a weekly window</div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {DAYS.map((d) => (
                <button
                  key={d.n}
                  onClick={() => setDays((s) => (s.includes(d.n) ? s.filter((x) => x !== d.n) : [...s, d.n]))}
                  className={cn("min-h-9 min-w-12 rounded-full border px-3 text-xs font-semibold", days.includes(d.n) ? "border-accent bg-accent text-on-accent" : "border-line text-muted")}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="From">
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" />
              </Field>
              <Field label="To">
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-32" />
              </Field>
              <Button
                disabled={days.length === 0}
                onClick={() => {
                  if (!validate(start, end)) return;
                  days.forEach((wd) => void report(addSlot({ kind: "RECURRING", weekday: wd, start, end })));
                }}
              >
                <Plus size={16} /> Add
              </Button>
            </div>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>One-off open slots</SectionTitle>
        <Card className="space-y-3 p-4">
          {oneOffs.map((s) => (
            <Row key={s.id} slot={s} text={`${format(parseISO(s.date!), "EEE d MMM yyyy")} · ${s.start}–${s.end}`} />
          ))}
          {oneOffs.length === 0 && <p className="text-xs text-muted">No special one-off windows. Add one for a public holiday or extra hours.</p>}
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
            <Field label="Date">
              <Input type="date" value={oneDate} onChange={(e) => setOneDate(e.target.value)} className="w-44" />
            </Field>
            <Field label="From">
              <Input type="time" value={oneStart} onChange={(e) => setOneStart(e.target.value)} className="w-32" />
            </Field>
            <Field label="To">
              <Input type="time" value={oneEnd} onChange={(e) => setOneEnd(e.target.value)} className="w-32" />
            </Field>
            <Button
              onClick={() => {
                if (!validate(oneStart, oneEnd)) return;
                void report(addSlot({ kind: "ONE_OFF", date: oneDate, start: oneStart, end: oneEnd }));
              }}
            >
              <Plus size={16} /> Add
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Blocked personal time</SectionTitle>
        <Card className="space-y-3 p-4">
          {blocks.map((s) => (
            <Row key={s.id} slot={s} icon text={`${format(parseISO(s.date!), "EEE d MMM yyyy")} · ${s.start}–${s.end}${s.label ? ` · ${s.label}` : ""}`} />
          ))}
          {blocks.length === 0 && <p className="text-xs text-muted">Nothing blocked. Blocked time hides slots from clients and prevents bookings.</p>}
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
            <Field label="Date">
              <Input type="date" value={blkDate} onChange={(e) => setBlkDate(e.target.value)} className="w-44" />
            </Field>
            <Field label="From">
              <Input type="time" value={blkStart} onChange={(e) => setBlkStart(e.target.value)} className="w-32" />
            </Field>
            <Field label="To">
              <Input type="time" value={blkEnd} onChange={(e) => setBlkEnd(e.target.value)} className="w-32" />
            </Field>
            <Field label="Label">
              <Input value={blkLabel} onChange={(e) => setBlkLabel(e.target.value)} className="w-44" />
            </Field>
            <Button
              variant="secondary"
              onClick={() => {
                if (!validate(blkStart, blkEnd)) return;
                void report(addSlot({ kind: "BLOCK", date: blkDate, start: blkStart, end: blkEnd, label: blkLabel.trim() || undefined }));
              }}
            >
              <Lock size={16} /> Block
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}

function Chip({ slot }: { slot: AvailabilitySlot }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 py-1 pl-3 pr-1 text-xs font-semibold text-accent">
      {slot.start}–{slot.end}
      <button aria-label="Remove window" onClick={() => deleteSlot(slot.id)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-accent/20">
        <Trash2 size={13} />
      </button>
    </span>
  );
}

function Row({ slot, text, icon }: { slot: AvailabilitySlot; text: string; icon?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-field px-3">
      <span className="flex min-h-11 items-center gap-2 text-sm">
        {icon && <Lock size={14} className="text-muted" />} {text}
      </span>
      <IconButton label="Remove" onClick={() => deleteSlot(slot.id)}>
        <Trash2 size={16} />
      </IconButton>
    </div>
  );
}
