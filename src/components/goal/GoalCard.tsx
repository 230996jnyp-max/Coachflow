"use client";

import { format, parseISO } from "date-fns";
import { Flag, Pencil, Target } from "lucide-react";
import { useState } from "react";
import { Button, Card, Field, Input, Modal, Notice, Select } from "@/components/ui";
import { weeklyTargetOf } from "@/lib/attention";
import { daysUntil } from "@/lib/fun";
import { useViewer } from "@/lib/hooks";
import { saveGoalInfo, useNow } from "@/lib/store";

/**
 * Goal and countdown: what someone is working towards, an event with a date ("Sundown Marathon, 7 Dec") counted down in days, and
 * the weekly target the training % is measured against. Shared between a client and their coach: either can edit the goal and the
 * event; the weekly target is set by the coach (or by the person themselves when they have no coach).
 */
export function GoalCard({ clientId, editable = true, canSetTarget = false, className }: { clientId: string; editable?: boolean; canSetTarget?: boolean; className?: string }) {
  const { db } = useViewer();
  const now = useNow(3_600_000);
  const [editing, setEditing] = useState(false);
  const profile = db.clients.find((c) => c.id === clientId);
  if (!profile) return null;

  const left = daysUntil(profile.goalEventDate, now);
  const hasEvent = !!profile.goalEventName || !!profile.goalEventDate;
  const target = weeklyTargetOf(profile);

  return (
    <Card className={className ?? "space-y-3 p-4"} data-tour="goal-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
          <Flag size={14} /> Goal &amp; countdown
        </h3>
        {editable && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Edit goal and countdown">
            <Pencil size={14} /> Edit
          </Button>
        )}
      </div>

      {profile.personalGoal ? (
        <p className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{profile.personalGoal}</p>
      ) : (
        <p className="text-sm text-muted">{editable ? "No goal yet. Add one so training has a point." : "No goal set yet."}</p>
      )}

      {hasEvent && (
        <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 p-3">
          <div className="min-w-[64px] text-center">
            {left === null ? (
              <div className="text-sm font-bold text-muted">—</div>
            ) : left > 0 ? (
              <>
                <div className="text-3xl font-bold leading-none tabular-nums text-accent">{left}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{left === 1 ? "day" : "days"}</div>
              </>
            ) : left === 0 ? (
              <div className="text-lg font-bold text-accent">Today!</div>
            ) : (
              <div className="text-sm font-bold text-muted">Passed</div>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{profile.goalEventName || "The big day"}</div>
            {profile.goalEventDate && <div className="text-xs text-muted">{format(parseISO(profile.goalEventDate), "EEE d MMM yyyy")}</div>}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted">
        <Target size={13} /> Weekly target: <b className="text-ink">{target} {target === 1 ? "session" : "sessions"}</b>
        {!profile.weeklyTarget && <span>(default)</span>}
      </div>

      {editing && <GoalForm clientId={clientId} canSetTarget={canSetTarget} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function GoalForm({ clientId, canSetTarget, onClose }: { clientId: string; canSetTarget: boolean; onClose: () => void }) {
  const { db } = useViewer();
  const p = db.clients.find((c) => c.id === clientId)!;
  const [goal, setGoal] = useState(p.personalGoal ?? "");
  const [event, setEvent] = useState(p.goalEventName ?? "");
  const [date, setDate] = useState(p.goalEventDate ?? "");
  const [target, setTarget] = useState(String(weeklyTargetOf(p)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const err = await saveGoalInfo(clientId, {
      personalGoal: goal.trim(),
      goalEventName: event.trim(),
      goalEventDate: date,
      ...(canSetTarget ? { weeklyTarget: Number(target) } : {}),
    });
    setBusy(false);
    if (err) return setError(err);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Goal & countdown"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Goal" hint="In their own words. Both the client and the coach can see this.">
          <Input value={goal} maxLength={200} onChange={(e) => setGoal(e.target.value)} placeholder="Run a 10k without stopping" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event (optional)">
            <Input value={event} maxLength={80} onChange={(e) => setEvent(e.target.value)} placeholder="City 10K" />
          </Field>
          <Field label="Event date" hint="Counts down in days.">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {canSetTarget && (
          <Field label="Weekly target" hint="Sessions a week. The training % on the Clients page is measured against this.">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "session" : "sessions"} a week
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
