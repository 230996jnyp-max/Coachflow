"use client";

import { AlertTriangle, Check, Trophy, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar, Card, Notice } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { annotatePRs, doneWorkouts, formatSet, PR_LABELS } from "@/lib/stats";
import { coachEditSet, useLivePolling } from "@/lib/store";
import type { Exercise, GroupSession, PRKind, UnitSystem, Workout, WorkoutExercise, WorkoutSet } from "@/lib/types";
import { cn, fromKg, round, toKg, weightUnit } from "@/lib/utils";
import { formatCustomSet } from "@/lib/tracking";

/** Number box that saves when you leave it (or press Enter) and shows changes made elsewhere. */
function EditCell({ label, value, onCommit, decimals = true, disabled }: { label: string; value: number | undefined; onCommit: (v: number | null) => void; decimals?: boolean; disabled?: boolean }) {
  return (
    <input
      key={String(value ?? "")}
      aria-label={label}
      inputMode={decimals ? "decimal" : "numeric"}
      defaultValue={value === undefined ? "" : String(value)}
      disabled={disabled}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      onBlur={(e) => {
        const raw = e.currentTarget.value.replace(",", ".").trim();
        if (raw === "") return value === undefined ? undefined : onCommit(null);
        const n = Number(raw);
        if (Number.isNaN(n) || n < 0) {
          e.currentTarget.value = value === undefined ? "" : String(value);
          return;
        }
        const next = decimals ? round(n, 2) : Math.round(n);
        if (next !== value) onCommit(next);
      }}
      className="h-10 w-full min-w-0 rounded-lg border border-transparent bg-field text-center text-sm font-semibold tabular-nums text-ink outline-none focus:border-accent disabled:opacity-50"
    />
  );
}

interface Progress {
  done: number;
  total: number;
  prs: number;
}

function progressOf(w: Workout | undefined, prMap: Map<string, PRKind[]>): Progress {
  if (!w) return { done: 0, total: 0, prs: 0 };
  let done = 0;
  let total = 0;
  let prs = 0;
  for (const we of w.exercises)
    for (const s of we.sets) {
      total++;
      if (s.done) {
        done++;
        if (prMap.get(s.id)?.length) prs++;
      }
    }
  return { done, total, prs };
}

function usePrMap(w: Workout | undefined, clientId: string) {
  const { db, exMap } = useViewer();
  return useMemo(() => {
    if (!w) return new Map<string, PRKind[]>();
    const history = doneWorkouts(db.workouts, clientId).filter((x) => x.id !== w.id);
    return annotatePRs([...history, w], exMap);
  }, [db.workouts, w, clientId, exMap]);
}

/**
 * The coach's view of a live group class: one card per attendee with their progress, and an editor for the selected
 * person. Updates every 3 seconds; changes the coach makes are saved as field-level edits that merge with the client's own.
 */
export function LiveGrid({ g }: { g: GroupSession }) {
  useLivePolling(true);
  const { db } = useViewer();
  const attendees = (g.members ?? []).filter((m) => m.status === "CONFIRMED" || m.status === "ATTENDED");
  const [sel, setSel] = useState<string | null>(null);
  const selected = attendees.find((m) => m.clientId === sel)?.clientId ?? attendees[0]?.clientId ?? null;

  if (attendees.length === 0) return <Notice>Nobody is booked into this class yet.</Notice>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {attendees.map((m) => (
          <AttendeeCard key={m.clientId} g={g} clientId={m.clientId} active={m.clientId === selected} onSelect={() => setSel(m.clientId)} name={db.users.find((u) => u.id === m.clientId)?.name ?? "Client"} />
        ))}
      </div>
      {selected && <AttendeeEditor key={selected} g={g} clientId={selected} />}
    </div>
  );
}

function AttendeeCard({ g, clientId, name, active, onSelect }: { g: GroupSession; clientId: string; name: string; active: boolean; onSelect: () => void }) {
  const { db, exMap, unit } = useViewer();
  const w = db.workouts.find((x) => x.groupId === g.id && x.clientId === clientId);
  const prMap = usePrMap(w, clientId);
  const p = progressOf(w, prMap);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <button type="button" onClick={onSelect} aria-pressed={active} className={cn("rounded-2xl border bg-surface p-3 text-left transition-colors", active ? "border-accent ring-1 ring-accent" : "border-line hover:border-accent/50")}>
      <div className="flex items-center gap-2">
        <Avatar name={name} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{name}</div>
          <div className="text-[11px] text-muted">{w ? (w.status === "DONE" ? "Finished" : `${p.done} of ${p.total} sets done`) : "Waiting for the workout…"}</div>
        </div>
        {p.prs > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-pr/15 px-2 py-0.5 text-[11px] font-bold text-pr">
            <Trophy size={11} /> {p.prs} PR{p.prs > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-field">
        <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
      </div>
      {w && (
        <ul className="mt-2 space-y-1">
          {w.exercises.slice(0, 5).map((we) => {
            const ex = exMap.get(we.exerciseId);
            return (
              <li key={we.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate text-muted">{ex?.name ?? "Exercise"}</span>
                <span className="flex shrink-0 gap-0.5">
                  {we.sets.map((s) => (
                    <span key={s.id} title={formatSet(s, ex, unit)} className={cn("h-2.5 w-2.5 rounded-full", s.done ? (prMap.get(s.id)?.length ? "bg-pr" : "bg-success") : "bg-line")} />
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </button>
  );
}

function AttendeeEditor({ g, clientId }: { g: GroupSession; clientId: string }) {
  const { db, exMap, unit } = useViewer();
  const w = db.workouts.find((x) => x.groupId === g.id && x.clientId === clientId);
  const prMap = usePrMap(w, clientId);
  const [error, setError] = useState<string | null>(null);
  const name = db.users.find((u) => u.id === clientId)?.name ?? "Client";
  if (!w) return <Notice>{name} doesn’t have the workout yet. It appears here as soon as they open the app.</Notice>;
  const live = w.status === "ACTIVE";
  const save = async (weId: string, setId: string, change: Parameters<typeof coachEditSet>[3]) => {
    setError(null);
    const err = await coachEditSet(w.id, weId, setId, change);
    if (err) setError(err);
  };
  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <UserRound size={16} className="text-muted" />
        <div className="text-sm font-bold">{name}</div>
        <div className="text-xs text-muted">· {w.title}</div>
        {!live && <span className="ml-auto text-xs font-semibold text-success">Finished</span>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {w.exercises.map((we) => (
        <ExerciseEditor key={we.id} we={we} ex={exMap.get(we.exerciseId)} unit={unit} prMap={prMap} disabled={!live} onSave={save} />
      ))}
      {w.exercises.length === 0 && <Notice>This workout has no exercises.</Notice>}
    </Card>
  );
}

function ExerciseEditor({ we, ex, unit, prMap, disabled, onSave }: { we: WorkoutExercise; ex?: Exercise; unit: UnitSystem; prMap: Map<string, PRKind[]>; disabled: boolean; onSave: (weId: string, setId: string, change: Parameters<typeof coachEditSet>[3]) => void }) {
  if (!ex) return null;
  if (ex.tracking) {
    // A sport drill with its own columns: the coach follows the values and can tick sets off; the client enters them.
    let k = 0;
    return (
      <div>
        <div className="mb-1 text-sm font-bold">{ex.name}</div>
        <div className="space-y-1">
          {we.sets.map((s: WorkoutSet) => {
            if (s.type === "N") k++;
            return (
              <div key={s.id} className={cn("flex items-center gap-2 rounded-xl px-1 py-1", s.done && "bg-success/10")}>
                <div className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg bg-field text-sm font-bold">{s.type === "N" ? k : s.type}</div>
                <div className="min-w-0 flex-1 truncate text-sm tabular-nums">{formatCustomSet(s, ex.tracking!)}</div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSave(we.id, s.id, { done: !s.done })}
                  aria-label={s.done ? "Mark set incomplete" : "Mark set complete"}
                  aria-pressed={s.done}
                  className={cn("flex h-10 w-11 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50", s.done ? "bg-success text-on-success" : "bg-field text-muted hover:text-ink")}
                >
                  <Check size={18} strokeWidth={3} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  const wl = weightUnit(unit).toUpperCase();
  const showW = (v?: number) => (v === undefined ? undefined : round(fromKg(v, unit), 2));
  const head = "text-center text-[10px] font-bold uppercase tracking-wider text-muted";
  const cardio = ex.type === "DURATION_DISTANCE";
  const timeOnly = ex.type === "DURATION_ONLY";
  const bodyOnly = ex.type === "BODYWEIGHT_REPS";
  const cols = cardio ? "36px 1fr 1fr 44px" : timeOnly ? "36px 1fr 44px" : bodyOnly ? "36px 1fr 44px" : "36px 1fr 1fr 44px";
  let n = 0;
  return (
    <div>
      <div className="mb-1 text-sm font-bold">{ex.name}</div>
      <div className="grid items-center gap-1.5 px-1 pb-1" style={{ gridTemplateColumns: cols }}>
        <div className={head}>Set</div>
        {cardio ? (
          <>
            <div className={head}>KM</div>
            <div className={head}>Sec</div>
          </>
        ) : timeOnly ? (
          <div className={head}>Sec</div>
        ) : (
          <>
            {!bodyOnly && <div className={head}>{ex.type === "WEIGHTED_BODYWEIGHT" ? `+${wl}` : wl}</div>}
            <div className={head}>Reps</div>
          </>
        )}
        <div className={head}>
          <Check size={14} className="mx-auto" />
        </div>
      </div>
      <div className="space-y-1">
        {we.sets.map((s: WorkoutSet) => {
          if (s.type === "N") n++;
          const flags = s.done ? prMap.get(s.id) : undefined;
          const edited = s.coachEdit && !s.coachEdit.superseded;
          return (
            <div key={s.id} className={cn("rounded-xl px-1 py-1", s.done && "bg-success/10")}>
              <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: cols }}>
                <div className="flex h-10 items-center justify-center rounded-lg bg-field text-sm font-bold">{s.type === "N" ? n : s.type}</div>
                {cardio ? (
                  <>
                    <EditCell label="Distance in km" value={s.distanceKm} disabled={disabled} onCommit={(v) => onSave(we.id, s.id, { distanceKm: v })} />
                    <EditCell label="Duration in seconds" value={s.durationSec} decimals={false} disabled={disabled} onCommit={(v) => onSave(we.id, s.id, { durationSec: v })} />
                  </>
                ) : timeOnly ? (
                  <EditCell label="Duration in seconds" value={s.durationSec} decimals={false} disabled={disabled} onCommit={(v) => onSave(we.id, s.id, { durationSec: v })} />
                ) : (
                  <>
                    {!bodyOnly && <EditCell label="Weight" value={showW(s.weight)} disabled={disabled} onCommit={(v) => onSave(we.id, s.id, { weight: v === null ? null : toKg(v, unit) })} />}
                    <EditCell label="Reps" value={s.reps} decimals={false} disabled={disabled} onCommit={(v) => onSave(we.id, s.id, { reps: v })} />
                  </>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSave(we.id, s.id, { done: !s.done })}
                  aria-label={s.done ? "Mark set incomplete" : "Mark set complete"}
                  aria-pressed={s.done}
                  className={cn("flex h-10 w-11 items-center justify-center rounded-lg transition-colors disabled:opacity-50", s.done ? "bg-success text-on-success" : "bg-field text-muted hover:text-ink")}
                >
                  <Check size={18} strokeWidth={3} />
                </button>
              </div>
              {(flags?.length || edited || s.coachEdit?.conflict) && (
                <div className="mt-1 flex flex-wrap gap-1 px-1 pb-1">
                  {flags?.map((f) => (
                    <span key={f} className="inline-flex items-center gap-1 rounded-full bg-pr/15 px-2 py-0.5 text-[11px] font-bold text-pr">
                      <Trophy size={11} /> {PR_LABELS[f]} PR
                    </span>
                  ))}
                  {edited && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">Edited by you</span>}
                  {s.coachEdit?.conflict && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger">
                      <AlertTriangle size={11} /> They changed this at the same time — their value was kept
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
