"use client";

import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, MoreHorizontal, NotebookPen, Play, Plus, Repeat, SkipForward, Timer, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ExercisePicker } from "@/components/ExerciseLibrary";
import { ExerciseDetailModal } from "@/components/exercise/ExerciseDetail";
import { ClientFocusBadge } from "@/components/sports/Focus";
import { Avatar, Button, Card, Field, IconButton, Input, Modal, Notice, Select } from "@/components/ui";
import { SET_CYCLE, SetHeader, SetRow } from "@/components/workout/SetRow";
import { applyRoutine, lastCoachNote, laneProgress, prefillExercises, type FloorSession } from "@/lib/floor";
import { useViewer } from "@/lib/hooks";
import { fillFromPrevious, isSetComplete, missingValueMessage, withPreviousFilled } from "@/lib/setLogging";
import { annotatePRs, doneWorkouts, findPrevious } from "@/lib/stats";
import { blankSet, updateWorkout, useNow } from "@/lib/store";
import type { Exercise, PRKind, SetType, Workout, WorkoutExercise, WorkoutSet } from "@/lib/types";
import { cn, fmtClock, uid, weightUnit } from "@/lib/utils";

/** A rest countdown for one person (the beep is fired once by the screen, not here). */
export interface LaneRest {
  endsAt: number;
  total: number;
  /** The countdown reached zero: they are ready for the next set. */
  over?: boolean;
}

export function RestChip({ rest, compact, onSkip, onAdjust }: { rest: LaneRest; compact?: boolean; onSkip?: () => void; onAdjust?: (sec: number) => void }) {
  const now = useNow(500);
  const left = rest.over ? 0 : Math.max(0, Math.ceil((rest.endsAt - now.getTime()) / 1000));
  const over = rest.over || left === 0;
  if (compact)
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", over ? "bg-success text-on-success" : "bg-accent/15 text-accent")}>
        <Timer size={11} /> {over ? "Ready" : fmtClock(left)}
      </span>
    );
  return (
    <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2", over ? "border-success/50 bg-success/15" : "border-accent/30 bg-accent/10")}>
      <Timer size={16} className={over ? "text-success" : "text-accent"} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{over ? "Rest over: next set" : "Rest"}</div>
        <div className="text-lg font-bold tabular-nums leading-none">{fmtClock(left)}</div>
      </div>
      {onAdjust && !over && (
        <>
          <button type="button" onClick={() => onAdjust(-15)} aria-label="Subtract 15 seconds" className="h-9 rounded-lg bg-field px-2 text-xs font-bold hover:bg-line">
            −15s
          </button>
          <button type="button" onClick={() => onAdjust(15)} aria-label="Add 15 seconds" className="h-9 rounded-lg bg-field px-2 text-xs font-bold hover:bg-line">
            +15s
          </button>
        </>
      )}
      {onSkip && (
        <button type="button" onClick={onSkip} aria-label={over ? "Dismiss" : "Skip rest"} className="inline-flex h-9 items-center gap-1 rounded-lg bg-accent px-2.5 text-xs font-bold text-on-accent">
          <SkipForward size={13} /> {over ? "OK" : "Skip"}
        </button>
      )}
    </div>
  );
}

export interface FloorLaneProps {
  session: FloorSession;
  clientId: string;
  workout: Workout | undefined;
  /** The routine chosen for starting this person ("" = an empty workout). */
  routineId: string;
  onChooseRoutine: (id: string) => void;
  onStart: () => void;
  starting: boolean;
  rest: LaneRest | undefined;
  restSeconds: number;
  onRest: (seconds: number) => void;
  onAdjustRest: (seconds: number) => void;
  onSkipRest: () => void;
}

/** One person's part of the session: their sets, rest timer and a private note. The coach taps ✓ per set; clients can log on their own phones too. */
export function FloorLane(p: FloorLaneProps) {
  const { db, exMap, unit } = useViewer();
  const { clientId, workout: w } = p;
  const user = db.users.find((u) => u.id === clientId);
  const name = user?.name ?? "Client";
  const [picker, setPicker] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [hint, setHint] = useState<{ weId: string; msg: string } | null>(null);
  const [infoFor, setInfoFor] = useState<Exercise | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [swap, setSwap] = useState("");

  const history = useMemo(() => doneWorkouts(db.workouts, clientId), [db.workouts, clientId]);
  const prMap = useMemo(() => {
    if (!w) return new Map<string, PRKind[]>();
    return annotatePRs([...history.filter((x) => x.id !== w.id), w], exMap);
  }, [history, w, exMap]);
  const note = lastCoachNote(db.workouts, clientId, w?.id);
  const prog = laneProgress(w);
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  const prefill = { clientId, workouts: db.workouts, exMap, unit, newId: uid };

  const header = (
    <div className="flex items-center gap-2.5">
      <Avatar name={name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-bold">{name}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          {w ? (
            <span>
              {prog.done} of {prog.total} sets{prog.prs > 0 ? ` · ${prog.prs} PR${prog.prs > 1 ? "s" : ""}` : ""}
            </span>
          ) : (
            <span>Not started</span>
          )}
          <ClientFocusBadge clientId={clientId} />
        </div>
      </div>
      {w && (
        <div className="relative">
          <IconButton label={`${name}: more`} onClick={() => setMenu(menu === "lane" ? null : "lane")} className="-mr-2">
            <MoreHorizontal size={20} />
          </IconButton>
          {menu === "lane" && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
              <div className="absolute right-0 z-30 w-52 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
                <MenuItem
                  icon={<Repeat size={16} />}
                  onClick={() => {
                    setMenu(null);
                    setSwap(w.templateId ?? "");
                    setRoutineOpen(true);
                  }}
                >
                  Change routine
                </MenuItem>
                <MenuItem
                  icon={<NotebookPen size={16} />}
                  onClick={() => {
                    setMenu(null);
                    setNoteOpen(true);
                  }}
                >
                  Note for next time
                </MenuItem>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  const noteBanner = note && (
    <div className="rounded-xl border border-pr/40 bg-pr/10 px-3 py-2 text-xs">
      <span className="font-bold text-pr">Last time ({format(parseISO(note.at), "d MMM")}):</span> <span className="text-ink">{note.note}</span>
    </div>
  );

  // Not started yet (a late walk-in, or the session has not begun): pick a routine, or start empty.
  if (!w) {
    return (
      <Card className="space-y-3 p-4">
        {header}
        {noteBanner}
        <Field label="Routine" hint="Weights and reps are filled in from what they did last time, with a small step up when it's due.">
          <Select value={p.routineId} onChange={(e) => p.onChooseRoutine(e.target.value)}>
            <option value="">Empty workout</option>
            {[...db.templates].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button className="w-full" onClick={p.onStart} disabled={p.starting}>
          <Play size={16} /> Start {name.split(" ")[0]}’s workout
        </Button>
      </Card>
    );
  }

  const up = (fn: (x: Workout) => Workout) => updateWorkout(w.id, fn);
  const patchEx = (weId: string, fn: (we: WorkoutExercise) => WorkoutExercise) => up((x) => ({ ...x, exercises: x.exercises.map((we) => (we.id === weId ? fn(we) : we)) }));
  const patchSet = (weId: string, setId: string, patch: Partial<WorkoutSet>) => patchEx(weId, (we) => ({ ...we, sets: we.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }));
  const prevFor = (we: WorkoutExercise, set: WorkoutSet): WorkoutSet | undefined => {
    const prev = findPrevious(history, w, we.exerciseId);
    if (!prev) return undefined;
    const warm = set.type === "W";
    const rank = we.sets.filter((s) => (s.type === "W") === warm).findIndex((s) => s.id === set.id);
    return prev.sets.filter((s) => (s.type === "W") === warm)[rank];
  };
  const flash = (weId: string, msg: string) => {
    setHint({ weId, msg });
    setTimeout(() => setHint((h) => (h?.weId === weId ? null : h)), 2600);
  };
  const toggleDone = (we: WorkoutExercise, set: WorkoutSet) => {
    const ex = exMap.get(we.exerciseId);
    if (!ex) return;
    if (set.done) {
      patchSet(we.id, set.id, { done: false });
      return;
    }
    const merged = withPreviousFilled(set, prevFor(we, set), ex);
    if (!isSetComplete(merged, ex)) {
      flash(we.id, missingValueMessage(ex));
      return;
    }
    patchSet(we.id, set.id, { ...merged, done: true });
    if (ex.type !== "DURATION_DISTANCE") p.onRest(p.restSeconds);
  };
  const move = (weId: string, dir: -1 | 1) =>
    up((x) => {
      const i = x.exercises.findIndex((e) => e.id === weId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= x.exercises.length) return x;
      const list = [...x.exercises];
      [list[i], list[j]] = [list[j], list[i]];
      return { ...x, exercises: list };
    });
  const wl = weightUnit(unit).toUpperCase();

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-3">
        {header}
        <div className="h-1.5 overflow-hidden rounded-full bg-field">
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
        </div>
        {p.rest && <RestChip rest={p.rest} onSkip={p.onSkipRest} onAdjust={p.onAdjustRest} />}
        {noteBanner}
        {(noteOpen || w.coachNote) && (
          <Field label="Note for next time (only you see this)">
            <Input value={w.coachNote ?? ""} onChange={(e) => up((x) => ({ ...x, coachNote: e.target.value || undefined }))} maxLength={1000} placeholder="Left knee sore, swapped to box squat…" className="h-10" />
          </Field>
        )}
      </Card>

      {w.exercises.length === 0 && <Notice>No exercises yet. Add one below, or change the routine from the menu.</Notice>}

      {w.exercises.map((we) => {
        const ex = exMap.get(we.exerciseId);
        if (!ex) return null;
        let n = 0;
        const tpl = w.templateId ? db.templates.find((t) => t.id === w.templateId)?.exercises.find((t) => t.exerciseId === we.exerciseId) : undefined;
        const repHint = tpl && tpl.repMax > 0 ? (tpl.repMin === tpl.repMax ? `${tpl.repMax}` : `${tpl.repMin}-${tpl.repMax}`) : undefined;
        return (
          <Card key={we.id} className="p-3">
            <div className="mb-2 flex items-start justify-between gap-2 px-1">
              <div className="min-w-0">
                <button type="button" onClick={() => setInfoFor(ex)} className="block max-w-full truncate text-left font-bold text-accent hover:underline" aria-label={`${ex.name}: photo, muscles and history`}>
                  {ex.name}
                </button>
                <div className="truncate text-xs text-muted">
                  {ex.primary} · {ex.equipment}
                </div>
              </div>
              <div className="relative">
                <IconButton label={`${ex.name}: options`} onClick={() => setMenu(menu === we.id ? null : we.id)} className="-mr-2 -mt-1">
                  <MoreHorizontal size={20} />
                </IconButton>
                {menu === we.id && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
                    <div className="absolute right-0 z-30 w-48 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
                      <MenuItem icon={<ArrowUp size={16} />} onClick={() => { move(we.id, -1); setMenu(null); }}>
                        Move up
                      </MenuItem>
                      <MenuItem icon={<ArrowDown size={16} />} onClick={() => { move(we.id, 1); setMenu(null); }}>
                        Move down
                      </MenuItem>
                      <MenuItem
                        danger
                        icon={<Trash2 size={16} />}
                        onClick={() => {
                          up((x) => ({ ...x, exercises: x.exercises.filter((e) => e.id !== we.id) }));
                          setMenu(null);
                        }}
                      >
                        Remove exercise
                      </MenuItem>
                    </div>
                  </>
                )}
              </div>
            </div>
            <SetHeader ex={ex} showRpe={false} unit={unit} wLabel={wl} />
            <div className="space-y-0.5">
              {we.sets.map((set) => {
                if (set.type === "N") n++;
                const prev = prevFor(we, set);
                return (
                  <SetRow
                    key={set.id}
                    set={set}
                    label={set.type === "N" ? String(n) : set.type}
                    ex={ex}
                    prev={prev}
                    unit={unit}
                    showRpe={false}
                    repHint={repHint}
                    prFlags={prMap.get(set.id)}
                    onChange={(patch) => patchSet(we.id, set.id, patch)}
                    onToggleDone={() => toggleDone(we, set)}
                    onCycleType={() => patchSet(we.id, set.id, { type: SET_CYCLE[(SET_CYCLE.indexOf(set.type) + 1) % SET_CYCLE.length] as SetType })}
                    onFillPrev={() => prev && patchSet(we.id, set.id, fillFromPrevious(prev, ex))}
                  />
                );
              })}
            </div>
            {hint?.weId === we.id && <p className="mt-2 px-1 text-xs font-semibold text-danger">{hint.msg}</p>}
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => patchEx(we.id, (x) => ({ ...x, sets: [...x.sets, blankSet(fillFromPrevious(x.sets[x.sets.length - 1], ex))] }))}>
                <Plus size={16} /> Add set
              </Button>
              <Button variant="ghost" disabled={we.sets.length <= 1} onClick={() => patchEx(we.id, (x) => ({ ...x, sets: x.sets.slice(0, -1) }))} aria-label="Remove last set">
                <X size={16} /> Last set
              </Button>
            </div>
          </Card>
        );
      })}

      <Button variant="outline" size="lg" className="w-full" onClick={() => setPicker(true)}>
        <Plus size={18} /> Add exercise
      </Button>

      <ExerciseDetailModal exercise={infoFor} onClose={() => setInfoFor(null)} clientId={clientId} />
      <ExercisePicker open={picker} clientId={clientId} onClose={() => setPicker(false)} onConfirm={(ids) => up((x) => ({ ...x, exercises: [...x.exercises, ...prefillExercises(ids, x, prefill)] }))} />

      <Modal
        open={routineOpen}
        onClose={() => setRoutineOpen(false)}
        title={`Change ${name.split(" ")[0]}’s routine`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRoutineOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!swap}
              onClick={() => {
                const t = db.templates.find((x) => x.id === swap);
                if (t) up((x) => applyRoutine(x, t, prefill));
                setRoutineOpen(false);
              }}
            >
              Use this routine
            </Button>
          </>
        }
      >
        <Field label="Routine" hint="Exercises with sets already ticked off are kept; the rest are replaced by this routine, pre-filled for them.">
          <Select value={swap} onChange={(e) => setSwap(e.target.value)}>
            <option value="">Choose a routine…</option>
            {[...db.templates].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </Modal>
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-h-11 w-full items-center gap-2.5 px-3 text-sm hover:bg-field", danger ? "text-danger" : "text-ink")}>
      {icon}
      {children}
    </button>
  );
}
