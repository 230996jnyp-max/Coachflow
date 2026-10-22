"use client";

import { Check, RotateCcw, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { Avatar, Button, Card, Modal, Notice, Toggle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { finishWorkout, refreshTraining, reopenSession, saveAttendance, type AttendanceTarget, type MarkChange } from "@/lib/store";
import type { AttendanceInfo, DB } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Person {
  clientId: string;
  name: string;
  /** Which credit this person's attendance uses. */
  pool: "SESSION" | "GROUP";
  role: "OWNER" | "MEMBER";
  attendance?: AttendanceInfo;
}

export interface Roll {
  target: AttendanceTarget;
  title: string;
  people: Person[];
  finalized: boolean;
  /** The groupId whose live workouts should be finished when the session is finalised. */
  groupId?: string;
}

/** Who is on the roll for a 1-on-1 session, partner session or class (from the coach's own data). */
export function rollFor(db: DB, target: AttendanceTarget): Roll | null {
  const nameOf = (id: string) => db.users.find((u) => u.id === id)?.name ?? "Client";
  if (target.kind === "BOOKING") {
    const b = db.bookings.find((x) => x.id === target.id);
    if (!b) return null;
    const g = db.groups.find((x) => x.kind === "SHARED" && x.status !== "CANCELLED" && (x.bookingId === b.id || x.id === b.sharedGroupId));
    const people: Person[] = [{ clientId: b.clientId, name: nameOf(b.clientId), pool: g ? "GROUP" : "SESSION", role: "OWNER", attendance: b.attendance }];
    for (const m of g?.members ?? []) if (m.role === "MEMBER" && ["CONFIRMED", "ATTENDED", "ABSENT"].includes(m.status)) people.push({ clientId: m.clientId, name: nameOf(m.clientId), pool: "GROUP", role: "MEMBER", attendance: m.attendance });
    return { target, title: g ? "Partner session" : "1-on-1 session", people, finalized: b.status === "COMPLETED" || b.status === "NO_SHOW", groupId: g?.id };
  }
  const g = db.groups.find((x) => x.id === target.id);
  if (!g) return null;
  const people: Person[] = (g.members ?? []).filter((m) => m.role === "MEMBER" && ["CONFIRMED", "ATTENDED", "ABSENT"].includes(m.status)).map((m) => ({ clientId: m.clientId, name: nameOf(m.clientId), pool: "GROUP" as const, role: "MEMBER" as const, attendance: m.attendance }));
  return { target, title: g.title, people, finalized: g.status === "COMPLETED", groupId: g.id };
}

const creditText = (a: AttendanceInfo | undefined, pool: "SESSION" | "GROUP") => {
  const what = pool === "GROUP" ? "group credit" : "session credit";
  if (!a) return `1 ${what} is reserved until you mark attendance`;
  if (a.mark === "PRESENT") return `1 ${what} taken`;
  return a.deduct ? `No-show — 1 ${what} deducted (coach override)` : `No-show — ${what} returned`;
};

function Row({ p, busy, onChange }: { p: Person; busy: boolean; onChange: (m: MarkChange) => void }) {
  const a = p.attendance;
  return (
    <div className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={p.name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{p.name}</div>
          <div className={cn("text-[11px]", a?.mark === "PRESENT" ? "text-success" : a?.mark === "NO_SHOW" ? (a.deduct ? "text-danger" : "text-pr") : "text-muted")}>{creditText(a, p.pool)}</div>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant={a?.mark === "PRESENT" ? "success" : "secondary"} disabled={busy} onClick={() => onChange({ clientId: p.clientId, mark: "PRESENT" })} aria-pressed={a?.mark === "PRESENT"}>
            <UserCheck size={14} /> Present
          </Button>
          <Button size="sm" variant={a?.mark === "NO_SHOW" ? "danger" : "secondary"} disabled={busy} onClick={() => onChange({ clientId: p.clientId, mark: "NO_SHOW", deduct: a?.mark === "NO_SHOW" ? a.deduct : false })} aria-pressed={a?.mark === "NO_SHOW"}>
            <UserX size={14} /> No-Show
          </Button>
        </div>
      </div>
      {a?.mark === "NO_SHOW" && (
        <div className="pl-11">
          <Toggle checked={a.deduct} onChange={(v) => onChange({ clientId: p.clientId, mark: "NO_SHOW", deduct: v })} label="No-Show — Deduct Credit Anyway" />
        </div>
      )}
    </div>
  );
}

/** Attendance roll call: tap Present or No-Show for each person at the start of class (changeable any time). */
export function RollCallPanel({ target }: { target: AttendanceTarget }) {
  const { db } = useViewer();
  const roll = rollFor(db, target);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState(false);
  if (!roll) return null;
  const save = async (marks: MarkChange[]) => {
    setBusy(true);
    setError(null);
    const err = await saveAttendance(target, marks);
    setBusy(false);
    if (err) setError(err);
  };
  const marked = roll.people.filter((p) => p.attendance).length;
  return (
    <Card className="space-y-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold">Attendance roll call</div>
          <div className="text-xs text-muted">
            {marked} of {roll.people.length} marked · Present takes 1 credit · No-Show returns it
          </div>
        </div>
        <div className="flex gap-2">
          {roll.people.length > 1 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => save(roll.people.filter((p) => p.attendance?.mark !== "PRESENT").map((p) => ({ clientId: p.clientId, mark: "PRESENT" as const })))}>
              <Check size={14} /> Mark all present
            </Button>
          )}
          {!roll.finalized ? (
            <Button size="sm" variant="success" disabled={busy} onClick={() => setFinal(true)}>
              <Check size={14} /> Finalize…
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={async () => setError(await reopenSession(target))}>
              <RotateCcw size={14} /> Reopen
            </Button>
          )}
        </div>
      </div>
      {roll.finalized && <Notice tone="success">Finalized. You can still change anyone’s attendance if something needs fixing — their credit is corrected automatically.</Notice>}
      <div className="divide-y divide-line">
        {roll.people.map((p) => (
          <Row key={p.clientId} p={p} busy={busy} onChange={(m) => save([m])} />
        ))}
        {roll.people.length === 0 && <div className="py-3 text-sm text-muted">Nobody is booked yet.</div>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <FinalAttendanceModal target={target} open={final} onClose={() => setFinal(false)} />
    </Card>
  );
}

/** The end-of-class confirmation: check everyone's attendance (late arrivals, etc.) and finalise the session. */
export function FinalAttendanceModal({ target, open, onClose }: { target: AttendanceTarget; open: boolean; onClose: () => void }) {
  return open ? <FinalForm key={`${target.kind}:${target.id}`} target={target} onClose={onClose} /> : null;
}

function FinalForm({ target, onClose }: { target: AttendanceTarget; onClose: () => void }) {
  const { db } = useViewer();
  const roll = rollFor(db, target);
  const [choice, setChoice] = useState<Record<string, { mark: "PRESENT" | "NO_SHOW"; deduct: boolean }>>(() =>
    Object.fromEntries((roll?.people ?? []).map((p) => [p.clientId, { mark: p.attendance?.mark ?? "PRESENT", deduct: p.attendance?.deduct ?? false }])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!roll) return null;
  const used = roll.people.filter((p) => choice[p.clientId]?.mark === "PRESENT" || (choice[p.clientId]?.mark === "NO_SHOW" && choice[p.clientId]?.deduct)).length;

  const finish = async () => {
    setBusy(true);
    setError(null);
    // Close out everyone's live workout first (kept with the sets they completed).
    if (roll.groupId) {
      await refreshTraining(true);
      for (const w of db.workouts.filter((x) => x.groupId === roll.groupId && x.status === "ACTIVE" && choice[x.clientId]?.mark === "PRESENT")) finishWorkout(w.id);
    }
    const err = await saveAttendance(
      target,
      roll.people.map((p) => ({ clientId: p.clientId, mark: choice[p.clientId].mark, deduct: choice[p.clientId].mark === "NO_SHOW" && choice[p.clientId].deduct })),
      true,
    );
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Final attendance confirmation"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" onClick={finish} disabled={busy || roll.people.length === 0}>
            <Check size={16} /> {busy ? "Saving…" : `Finalize · ${used} credit${used === 1 ? "" : "s"} used`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">Check each person before you finish — for example, someone who arrived late after the first roll call. A No-Show returns the credit unless you choose to deduct it.</p>
        <div className="divide-y divide-line rounded-xl border border-line px-3">
          {roll.people.map((p) => {
            const c = choice[p.clientId];
            return (
              <div key={p.clientId} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={p.name} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                    <div className="text-[11px] text-muted">{p.pool === "GROUP" ? "Group class credit" : "1-on-1 session credit"}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant={c.mark === "PRESENT" ? "success" : "secondary"} onClick={() => setChoice((s) => ({ ...s, [p.clientId]: { ...s[p.clientId], mark: "PRESENT" } }))}>
                      Present
                    </Button>
                    <Button size="sm" variant={c.mark === "NO_SHOW" ? "danger" : "secondary"} onClick={() => setChoice((s) => ({ ...s, [p.clientId]: { ...s[p.clientId], mark: "NO_SHOW" } }))}>
                      No-Show
                    </Button>
                  </div>
                </div>
                {c.mark === "NO_SHOW" && (
                  <div className="pl-10">
                    <Toggle checked={c.deduct} onChange={(v) => setChoice((s) => ({ ...s, [p.clientId]: { ...s[p.clientId], deduct: v } }))} label="No-Show — Deduct Credit Anyway" />
                    <p className="text-[11px] text-muted">{c.deduct ? "The credit will be taken as a late no-show penalty." : "Default: the credit is returned to the client."}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
