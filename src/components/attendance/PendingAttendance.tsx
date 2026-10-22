"use client";

import { format, isBefore, parseISO } from "date-fns";
import { ClipboardCheck, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { saveAttendance, useNow, type AttendanceTarget } from "@/lib/store";
import { FinalAttendanceModal, rollFor } from "./Attendance";

interface Item {
  key: string;
  target: AttendanceTarget;
  start: string;
  title: string;
}

/** Past sessions and classes whose attendance hasn't been finalised yet, with one-tap actions. */
export function PendingAttendance() {
  const { db } = useViewer();
  const now = useNow(60_000);
  const [review, setReview] = useState<AttendanceTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items: Item[] = [];
  for (const b of db.bookings) {
    if (b.status !== "CONFIRMED" || b.clientId === "other" || !isBefore(parseISO(b.end), now)) continue;
    const r = rollFor(db, { kind: "BOOKING", id: b.id });
    if (r) items.push({ key: `b${b.id}`, target: r.target, start: b.start, title: r.people.map((p) => p.name).join(", ") });
  }
  for (const g of db.groups) {
    if (g.kind !== "CLASS" || g.status !== "OPEN" || !isBefore(parseISO(g.end), now) || (g.members ?? []).every((m) => m.status !== "CONFIRMED")) continue;
    items.push({ key: `g${g.id}`, target: { kind: "GROUP", id: g.id }, start: g.start, title: g.title });
  }
  items.sort((a, b) => a.start.localeCompare(b.start));
  if (items.length === 0) return null;

  const quick = async (it: Item, marks: { clientId: string; mark: "PRESENT" | "NO_SHOW" }[]) => {
    setBusy(it.key);
    setError(null);
    const err = await saveAttendance(it.target, marks, true);
    setBusy(null);
    if (err) setError(err);
  };

  return (
    <Card className="space-y-3 border-pr/40 bg-pr/5 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-pr">
        <ClipboardCheck size={18} /> Pending attendance · {items.length}
      </div>
      <p className="text-xs text-muted">These sessions have finished but attendance isn’t confirmed yet. A client who was present uses 1 credit; a no-show gets it back.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="space-y-2">
        {items.map((it) => {
          const roll = rollFor(db, it.target);
          if (!roll) return null;
          const single = roll.people.length === 1;
          const only = roll.people[0];
          const all = roll.people.length > 0;
          return (
            <div key={it.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{it.target.kind === "GROUP" ? it.title : roll.people.length > 1 ? `Partner session · ${roll.people.length} people` : it.title}</div>
                <div className="text-xs text-muted">
                  {format(parseISO(it.start), "EEE d MMM · h:mm a")}
                  {it.target.kind === "GROUP" ? ` · ${roll.people.length} booked` : ""}
                </div>
              </div>
              {single && !only.attendance ? (
                <>
                  <Button size="sm" variant="success" disabled={busy === it.key} onClick={() => quick(it, [{ clientId: only.clientId, mark: "PRESENT" }])}>
                    <UserCheck size={14} /> Present
                  </Button>
                  <Button size="sm" variant="danger" disabled={busy === it.key} onClick={() => quick(it, [{ clientId: only.clientId, mark: "NO_SHOW" }])}>
                    <UserX size={14} /> No-Show
                  </Button>
                </>
              ) : (
                all && (
                  <Button size="sm" variant="success" disabled={busy === it.key} onClick={() => quick(it, roll.people.filter((p) => !p.attendance).map((p) => ({ clientId: p.clientId, mark: "PRESENT" as const })))}>
                    <UserCheck size={14} /> {roll.people.some((p) => p.attendance) ? "Finalize" : "All present"}
                  </Button>
                )
              )}
              <Button size="sm" variant="secondary" onClick={() => setReview(it.target)}>
                Review
              </Button>
            </div>
          );
        })}
      </div>
      {review && <FinalAttendanceModal target={review} open onClose={() => setReview(null)} />}
    </Card>
  );
}
