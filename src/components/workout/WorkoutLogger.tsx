"use client";

import { format, parseISO } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ExercisePicker } from "@/components/ExerciseLibrary";
import { ExerciseDetailModal } from "@/components/exercise/ExerciseDetail";
import { GymSelect } from "@/components/GymSelect";
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  Modal,
  Notice,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { annotatePRs, doneWorkouts, findPrevious, PR_LABELS, workoutSetCount, workoutVolume } from "@/lib/stats";
import {
  blankSet,
  deleteWorkout,
  finishWorkout,
  newWorkoutExercise,
  templateFromWorkout,
  updateWorkout,
  useNow,
} from "@/lib/store";
import type { Exercise, PRKind, SetType, Workout, WorkoutExercise, WorkoutSet } from "@/lib/types";
import { cn, fmtClock, fmtDurationShort, fmtVolume, weightUnit } from "@/lib/utils";
import { makeRest, RestTimerBar, type RestState } from "./RestTimer";
import { SET_CYCLE, SetHeader, SetRow } from "./SetRow";

function LiveTimer({ since }: { since: string }) {
  const now = useNow(1000);
  return <span className="tabular-nums">{fmtClock((now.getTime() - parseISO(since).getTime()) / 1000)}</span>;
}

export function WorkoutLogger({ workoutId }: { workoutId: string }) {
  const { db, user, unit, exMap, isTrainer } = useViewer();
  const router = useRouter();

  const w = db.workouts.find((x) => x.id === workoutId);
  const [picker, setPicker] = useState(false);
  const [rest, setRest] = useState<RestState | null>(null);
  const [restOn, setRestOn] = useState(true);
  const [restSec, setRestSec] = useState<number>(db.settings.restSeconds);
  const [showRpe, setShowRpe] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [hint, setHint] = useState<{ weId: string; msg: string } | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [summary, setSummary] = useState(false);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState<string[]>([]);
  const [infoFor, setInfoFor] = useState<Exercise | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(() => (w ? !w.liveStartedAt && w.status === "ACTIVE" : false));

  const clientWorkouts = useMemo(() => doneWorkouts(db.workouts, w?.clientId), [db.workouts, w?.clientId]);

  const prMap = useMemo(() => {
    if (!w) return new Map<string, PRKind[]>();
    const others = clientWorkouts.filter((x) => x.id !== w.id);
    return annotatePRs([...others, w], exMap);
  }, [clientWorkouts, w, exMap]);

  const exerciseKey = w?.exercises.map((e) => e.exerciseId).join(",") ?? "";
  const prevMap = useMemo(() => {
    const m = new Map<string, WorkoutExercise | undefined>();
    if (!w) return m;
    for (const we of w.exercises) m.set(we.id, findPrevious(clientWorkouts, w, we.exerciseId));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientWorkouts, w?.id, w?.startedAt, exerciseKey]);

  const template = w?.templateId ? db.templates.find((t) => t.id === w.templateId) : undefined;

  if (!user) return null;
  if (!w || (!isTrainer && w.clientId !== user.id)) {
    return (
      <Card className="p-8 text-center">
        <div className="font-semibold">Workout not found</div>
        <Link href="/workout" className="mt-3 inline-block text-sm text-accent">
          Back to workouts
        </Link>
      </Card>
    );
  }

  const client = db.users.find((u) => u.id === w.clientId);
  const isActive = w.status === "ACTIVE";
  const up = (fn: (x: Workout) => Workout) => updateWorkout(w.id, fn);
  const patchEx = (weId: string, fn: (we: WorkoutExercise) => WorkoutExercise) =>
    up((x) => ({ ...x, exercises: x.exercises.map((we) => (we.id === weId ? fn(we) : we)) }));
  const patchSet = (weId: string, setId: string, patch: Partial<WorkoutSet>) =>
    patchEx(weId, (we) => ({ ...we, sets: we.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }));

  const prevSetFor = (we: WorkoutExercise, set: WorkoutSet): WorkoutSet | undefined => {
    const prev = prevMap.get(we.id);
    if (!prev) return undefined;
    const warm = set.type === "W";
    const rank = we.sets.filter((s) => (s.type === "W") === warm).findIndex((s) => s.id === set.id);
    return prev.sets.filter((s) => (s.type === "W") === warm)[rank];
  };

  const flash = (weId: string, msg: string) => {
    setHint({ weId, msg });
    setTimeout(() => setHint((h) => (h?.weId === weId ? null : h)), 2600);
  };

  const fillFrom = (prev: WorkoutSet | undefined, ex: Exercise): Partial<WorkoutSet> => {
    if (!prev) return {};
    const p: Partial<WorkoutSet> = {};
    if (ex.type === "WEIGHT_REPS" || ex.type === "WEIGHTED_BODYWEIGHT") {
      p.weight = prev.weight;
      p.reps = prev.reps;
    } else if (ex.type === "BODYWEIGHT_REPS") p.reps = prev.reps;
    else if (ex.type === "DURATION_ONLY") p.durationSec = prev.durationSec;
    else {
      p.distanceKm = prev.distanceKm;
      p.durationSec = prev.durationSec;
      p.level = prev.level;
      p.calories = prev.calories;
    }
    return p;
  };

  const toggleDone = (we: WorkoutExercise, set: WorkoutSet) => {
    const ex = exMap.get(we.exerciseId);
    if (!ex) return;
    if (set.done) {
      patchSet(we.id, set.id, { done: false });
      return;
    }
    const prev = prevSetFor(we, set);
    const merged: WorkoutSet = { ...set };
    const fill = fillFrom(prev, ex);
    // Use "previous" values for any field the user left empty.
    (Object.keys(fill) as (keyof WorkoutSet)[]).forEach((k) => {
      if (merged[k] === undefined && fill[k] !== undefined) (merged as unknown as Record<string, unknown>)[k] = fill[k];
    });
    const valid =
      ex.type === "DURATION_ONLY"
        ? !!merged.durationSec
        : ex.type === "DURATION_DISTANCE"
          ? !!merged.durationSec || !!merged.distanceKm
          : !!merged.reps && merged.reps > 0;
    if (!valid) {
      flash(
        we.id,
        ex.type === "DURATION_ONLY" ? "Enter a duration first." : ex.type === "DURATION_DISTANCE" ? "Enter a time or distance first." : "Enter reps first.",
      );
      return;
    }
    patchSet(we.id, set.id, { ...merged, done: true });
    if (restOn && ex.type !== "DURATION_DISTANCE") {
      setRest(makeRest(restSec));
    }
  };

  const cycleType = (we: WorkoutExercise, set: WorkoutSet) => {
    const next = SET_CYCLE[(SET_CYCLE.indexOf(set.type) + 1) % SET_CYCLE.length] as SetType;
    patchSet(we.id, set.id, { type: next });
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

  const totalVol = workoutVolume(w, exMap);
  const doneSets = workoutSetCount(w);
  const pendingSets = w.exercises.reduce((n, we) => n + we.sets.filter((s) => !s.done).length, 0);
  const wUnit = weightUnit(unit);

  const finish = () => {
    finishWorkout(w.id);
    setSummary(true);
  };

  const exitTo = () => router.push(isTrainer && w.clientId !== user.id ? `/clients/${w.clientId}` : "/workout");

  const prList = w.exercises.flatMap((we) =>
    we.sets.filter((s) => s.pr?.length).map((s) => ({ we, s })),
  );

  return (
    <div className={cn(rest && "pb-24")}>
      {/* Header */}
      <Card className="mb-4 space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <input
            value={w.title}
            onChange={(e) => up((x) => ({ ...x, title: e.target.value }))}
            aria-label="Workout title"
            placeholder="Workout title"
            className="min-w-0 flex-1 bg-transparent text-xl font-bold outline-none placeholder:text-muted/60"
          />
          {isActive ? (
            <Button variant="success" onClick={() => (pendingSets > 0 || doneSets === 0 ? setConfirmFinish(true) : finish())}>
              <Check size={18} /> Finish
            </Button>
          ) : (
            <Button
              onClick={() => {
                finishWorkout(w.id);
                exitTo();
              }}
            >
              <Check size={18} /> Save
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {client && (
            <span className="inline-flex items-center gap-2 rounded-full bg-field py-1 pl-1 pr-3">
              <Avatar name={client.name} size={22} />
              <span className="font-semibold">{client.name}</span>
            </span>
          )}
          <Badge className={w.loggedBy === "TRAINER" ? "border-accent/30 bg-accent/15 text-accent" : undefined}>
            Logged by {w.loggedBy === "TRAINER" ? "Trainer" : "Client"}
          </Badge>
          {!isActive && <Badge className="border-success/30 bg-success/15 text-success">Completed</Badge>}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-field py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Duration</div>
            <div className="text-lg font-bold">
              {w.liveStartedAt ? <LiveTimer since={w.liveStartedAt} /> : fmtDurationShort(w.durationSec)}
            </div>
          </div>
          <div className="rounded-xl bg-field py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Volume</div>
            <div className="text-lg font-bold">{fmtVolume(totalVol, unit)}</div>
          </div>
          <div className="rounded-xl bg-field py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Sets</div>
            <div className="text-lg font-bold">{doneSets}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          aria-expanded={detailsOpen}
          className="flex min-h-11 w-full items-center justify-between rounded-xl bg-field px-3 text-sm font-semibold"
        >
          <span>Details &amp; settings</span>
          {detailsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {detailsOpen && (
        <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date & time">
            <Input
              type="datetime-local"
              value={format(parseISO(w.startedAt), "yyyy-MM-dd'T'HH:mm")}
              onChange={(e) => {
                const d = new Date(e.target.value);
                if (!Number.isNaN(d.getTime())) up((x) => ({ ...x, startedAt: d.toISOString() }));
              }}
            />
          </Field>
          <Field label="Gym location">
            <GymSelect value={w.gymId ?? ""} onChange={(v) => up((x) => ({ ...x, gymId: v || null }))} noneLabel="No gym / home" />
          </Field>
          {!w.liveStartedAt && (
            <Field label="Duration (minutes)" hint="Back-dated logs use a manual duration.">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={w.durationSec ? Math.round(w.durationSec / 60) : ""}
                onChange={(e) => up((x) => ({ ...x, durationSec: Math.max(0, Number(e.target.value) || 0) * 60 }))}
                placeholder="60"
              />
            </Field>
          )}
          <Field label="Session notes">
            <Textarea
              value={w.notes}
              onChange={(e) => up((x) => ({ ...x, notes: e.target.value }))}
              placeholder="How did it feel? Form cues, injuries…"
              className="min-h-11"
              rows={1}
            />
          </Field>
        </div>

        <div className="grid gap-x-6 sm:grid-cols-2">
          <Toggle checked={restOn} onChange={setRestOn} label="Auto rest timer" />
          <Toggle checked={showRpe} onChange={setShowRpe} label="Show RPE column" />
          {restOn && (
            <div className="sm:col-span-2">
              <Field label="Rest duration">
                <Select value={restSec} onChange={(e) => setRestSec(Number(e.target.value))}>
                  {[30, 45, 60, 90, 120, 150, 180, 240, 300].map((s) => (
                    <option key={s} value={s}>
                      {fmtClock(s)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
        </>
        )}
      </Card>

      {/* Exercises */}
      <div className="space-y-4">
        {w.exercises.map((we, idx) => {
          const ex = exMap.get(we.exerciseId);
          if (!ex) return null;
          let n = 0;
          const hintMsg = hint?.weId === we.id ? hint.msg : null;
          const tpl = template?.exercises.find((t) => t.exerciseId === we.exerciseId);
          const repHint = tpl && tpl.repMax > 0 ? (tpl.repMin === tpl.repMax ? `${tpl.repMax}` : `${tpl.repMin}-${tpl.repMax}`) : undefined;
          return (
            <Card key={we.id} className="p-3">
              <div className="mb-2 flex items-start justify-between gap-2 px-1">
                <div className="min-w-0">
                  <button type="button" onClick={() => setInfoFor(ex)} className="block max-w-full truncate text-left font-bold text-accent hover:underline" aria-label={`${ex.name} — view photo, muscles and history`}>
                    {ex.name}
                  </button>
                  <div className="text-xs text-muted">
                    {ex.primary} · {ex.equipment}
                  </div>
                </div>
                <div className="relative">
                  <IconButton label="Exercise options" onClick={() => setMenu(menu === we.id ? null : we.id)} className="-mr-2 -mt-1">
                    <MoreHorizontal size={20} />
                  </IconButton>
                  {menu === we.id && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
                      <div className="absolute right-0 z-30 w-48 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
                        <MenuItem
                          icon={<NotebookPen size={16} />}
                          onClick={() => {
                            setNotesOpen((o) => (o.includes(we.id) ? o : [...o, we.id]));
                            setMenu(null);
                          }}
                        >
                          Add note
                        </MenuItem>
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

              {(notesOpen.includes(we.id) || we.notes) && (
                <div className="mb-2 px-1">
                  <Input
                    value={we.notes ?? ""}
                    onChange={(e) => patchEx(we.id, (x) => ({ ...x, notes: e.target.value }))}
                    placeholder="Exercise notes (tempo, cues, machine settings)…"
                    className="h-10"
                  />
                </div>
              )}

              <SetHeader ex={ex} showRpe={showRpe} unit={unit} wLabel={wUnit.toUpperCase()} />
              <div className="space-y-0.5">
                {we.sets.map((set) => {
                  if (set.type === "N") n++;
                  const label = set.type === "N" ? String(n) : set.type;
                  const prev = prevSetFor(we, set);
                  return (
                    <SetRow
                      key={set.id}
                      set={set}
                      label={label}
                      ex={ex}
                      prev={prev}
                      unit={unit}
                      showRpe={showRpe}
                      repHint={repHint}
                      prFlags={prMap.get(set.id)}
                      onChange={(patch) => patchSet(we.id, set.id, patch)}
                      onToggleDone={() => toggleDone(we, set)}
                      onCycleType={() => cycleType(we, set)}
                      onFillPrev={() => prev && patchSet(we.id, set.id, fillFrom(prev, ex))}
                    />
                  );
                })}
              </div>

              {hintMsg && <p className="mt-2 px-1 text-xs font-semibold text-danger">{hintMsg}</p>}

              <div className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => patchEx(we.id, (x) => ({ ...x, sets: [...x.sets, blankSet()] }))}
                >
                  <Plus size={16} /> Add Set
                </Button>
                <Button
                  variant="ghost"
                  disabled={we.sets.length <= 1}
                  onClick={() => patchEx(we.id, (x) => ({ ...x, sets: x.sets.slice(0, -1) }))}
                  aria-label="Remove last set"
                >
                  <X size={16} /> Last set
                </Button>
              </div>
              <div className="sr-only">Exercise {idx + 1}</div>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 space-y-2">
        <Button variant="outline" size="lg" className="w-full" onClick={() => setPicker(true)}>
          <Plus size={18} /> Add Exercise
        </Button>
        <div className="flex gap-2">
          {w.exercises.length > 0 && (
            <Button variant="secondary" className="flex-1" onClick={() => setTemplateName(w.title || "My Routine")}>
              <BookmarkPlus size={16} /> Save as template
            </Button>
          )}
          <Button variant="danger" className="flex-1" onClick={() => setConfirmDiscard(true)}>
            <Trash2 size={16} /> {isActive ? "Discard workout" : "Delete workout"}
          </Button>
        </div>
      </div>

      <ExerciseDetailModal exercise={infoFor} onClose={() => setInfoFor(null)} clientId={w.clientId} />

      {rest && <RestTimerBar rest={rest} onChange={setRest} onDismiss={() => setRest(null)} />}

      <ExercisePicker
        open={picker}
        onClose={() => setPicker(false)}
        onConfirm={(ids) =>
          up((x) => ({
            ...x,
            exercises: [
              ...x.exercises,
              ...ids.map((id) => newWorkoutExercise(id, exMap.get(id)?.type === "DURATION_DISTANCE" ? 1 : 3)),
            ],
          }))
        }
      />

      <ConfirmDialog
        open={confirmFinish}
        onClose={() => setConfirmFinish(false)}
        title={doneSets === 0 ? "No completed sets" : "Finish workout?"}
        message={
          doneSets === 0
            ? "You haven’t completed any sets. Tick the ✓ on a set to record it, or discard this workout."
            : `${pendingSets} set${pendingSets === 1 ? " is" : "s are"} not completed and will be removed from the log.`
        }
        confirmLabel={doneSets === 0 ? "OK" : "Finish anyway"}
        onConfirm={() => doneSets > 0 && finish()}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        danger
        title={isActive ? "Discard workout?" : "Delete workout?"}
        message="All logged sets in this workout will be permanently removed."
        confirmLabel={isActive ? "Discard" : "Delete"}
        onConfirm={() => {
          deleteWorkout(w.id);
          exitTo();
        }}
      />

      <Modal
        open={templateName !== null}
        onClose={() => setTemplateName(null)}
        title="Save as routine template"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTemplateName(null)}>
              Cancel
            </Button>
            <Button
              disabled={!templateName?.trim()}
              onClick={() => {
                templateFromWorkout(w.id, templateName!.trim(), user.id, isTrainer);
                setTemplateName(null);
              }}
            >
              Save template
            </Button>
          </>
        }
      >
        <Field label="Template name" hint={isTrainer ? "Trainer templates are shared with all clients." : undefined}>
          <Input value={templateName ?? ""} onChange={(e) => setTemplateName(e.target.value)} autoFocus />
        </Field>
      </Modal>

      <Modal
        open={summary}
        onClose={() => {
          setSummary(false);
          exitTo();
        }}
        title="Workout complete"
        footer={
          <Button
            onClick={() => {
              setSummary(false);
              exitTo();
            }}
          >
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <SummaryStat label="Duration" value={fmtDurationShort(w.durationSec)} />
            <SummaryStat label="Volume" value={fmtVolume(totalVol, unit)} />
            <SummaryStat label="Sets" value={String(doneSets)} />
          </div>
          {prList.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-pr">
                <Trophy size={16} /> {prList.length} personal record{prList.length > 1 ? "s" : ""}!
              </div>
              <ul className="space-y-1.5">
                {prList.slice(0, 8).map(({ we, s }) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-pr/10 px-3 py-2 text-sm">
                    <span className="truncate font-medium">{exMap.get(we.exerciseId)?.name}</span>
                    <span className="shrink-0 text-xs font-semibold text-pr">{s.pr!.map((p) => PR_LABELS[p]).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Notice>Great work — consistency builds records. No new PRs this time.</Notice>
          )}
        </div>
      </Modal>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-field py-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn("flex min-h-11 w-full items-center gap-2.5 px-3 text-sm hover:bg-field", danger ? "text-danger" : "text-ink")}
    >
      {icon}
      {children}
    </button>
  );
}
