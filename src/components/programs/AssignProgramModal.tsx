"use client";

import { format, parseISO } from "date-fns";
import { useState } from "react";
import { Button, Field, Input, Modal, Notice, Select, Toggle } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { programEnd } from "@/lib/programs";
import { api, refreshAssignments } from "@/lib/store";

const todayKey = () => format(new Date(), "yyyy-MM-dd");

/**
 * Gives a program to a client from a start date (day 1 of week 1 is that date). With Live Sync on, later changes to the program reach the
 * client's coming workouts. Someone training on their own assigns it to themselves, so there is no client to choose.
 */
export function AssignProgramModal({
  program,
  solo,
  clientId,
  onClose,
  onDone,
}: {
  program: { id: string; name: string; weeks: number; slotCount: number };
  solo: boolean;
  /** Pre-select this client (when opened from their Plan tab). */
  clientId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { clients, user } = useViewer();
  const active = clients.filter((c) => !c.profile.archived);
  const [client, setClient] = useState(clientId ?? active[0]?.user.id ?? "");
  const [start, setStart] = useState(todayKey());
  const [liveSync, setLiveSync] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: number; beyond: number } | null>(null);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const end = valid ? programEnd(start, program.weeks) : "";
  const person = solo ? "you" : (active.find((c) => c.user.id === client)?.user.name ?? "the client");

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ created: number; skipped: number; beyond: number }>(`/api/programs/${program.id}/assign`, { body: { clientId: solo ? user?.id : client, startDate: start, liveSync } });
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.error ?? "Couldn't assign the program.");
    await refreshAssignments();
    setDone(r.data);
    onDone();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={solo ? "Start this program" : "Assign this program"}
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !valid || (!solo && !client)} onClick={() => void submit()}>
              {busy ? "Assigning…" : solo ? "Start it" : "Assign it"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-3">
          <Notice tone="success">
            {done.created} workout{done.created === 1 ? "" : "s"} {solo ? "added to your calendar" : `assigned to ${person}`}, from {format(parseISO(start), "EEE d MMM")}.
          </Notice>
          {done.skipped > 0 && <Notice tone="warn">{done.skipped} day{done.skipped === 1 ? " was" : "s were"} left out because {done.skipped === 1 ? "it already has" : "they already have"} 3 workouts.</Notice>}
          {done.beyond > 0 && <Notice tone="warn">{done.beyond} workout{done.beyond === 1 ? " is" : "s are"} more than six months away, so {done.beyond === 1 ? "it was" : "they were"} left out.</Notice>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            <b className="text-ink">{program.name}</b>: {program.weeks} week{program.weeks === 1 ? "" : "s"}, {program.slotCount} workout{program.slotCount === 1 ? "" : "s"}. Day 1 is the start day you pick.
          </p>
          {!solo && (
            <Field label="Client">
              <Select value={client} onChange={(e) => setClient(e.target.value)} disabled={!!clientId}>
                {active.map((c) => (
                  <option key={c.user.id} value={c.user.id}>
                    {c.user.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Start day" hint={valid ? `Runs until ${format(parseISO(end), "EEE d MMM yyyy")}.` : "Pick a date."}>
            <Input type="date" value={start} min={todayKey()} onChange={(e) => setStart(e.target.value)} />
          </Field>
          {!solo && (
            <>
              <Toggle checked={liveSync} onChange={setLiveSync} label="Live Sync: later changes to the program reach their coming workouts" />
              <p className="text-xs text-muted">
                Live Sync only changes days after today, never a day you edited by hand, and never a workout already done. {person} gets a notification that the program has started.
              </p>
            </>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </Modal>
  );
}
