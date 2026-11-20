"use client";

import { addDays, format, isToday, parseISO } from "date-fns";
import { AlertTriangle, CalendarPlus, Check, ChevronLeft, ChevronRight, Copy, Dumbbell, Plus, Repeat, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { assignmentState, dayKey, isAssignmentDone, MAX_REPEAT_WEEKS, resultOf, sortAssignments, weekStartOf, type AssignState } from "@/lib/assignments";
import { useViewer } from "@/lib/hooks";
import { assignWorkout, copyAssignment, moveAssignment, removeAssignment, setAssignmentDone, setAssignmentNote, useNow } from "@/lib/store";
import type { Assignment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ClientPrograms } from "@/components/programs/ClientPrograms";
import { ProgramSuggestions } from "@/components/programs/ProgramSuggestions";
import { ExerciseRows, PhonePreview } from "./PhonePreview";

const STATE_STYLE: Record<AssignState, string> = {
  done: "border-success/40 bg-success/15 text-success",
  today: "border-accent/50 bg-accent/15 text-accent",
  upcoming: "border-line bg-field text-ink",
  missed: "border-danger/40 bg-danger/10 text-danger",
};
const STATE_LABEL: Record<AssignState, string> = { done: "Done", today: "Today", upcoming: "Upcoming", missed: "Missed" };

/**
 * The coach's plan for one client: two weeks at a time with a + on every day. Tap a day to assign one of your routines (with a preview of
 * what the client will see, and an option to repeat it weekly); tap an assigned workout to move it, copy it, tick it off or delete it.
 */
export function PlanTab({ clientId }: { clientId: string }) {
  const { db, user } = useViewer();
  const now = useNow(60_000);
  const todayKey = dayKey(now);
  const [start, setStart] = useState(() => weekStartOf(new Date()));
  const [assigning, setAssigning] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const mine = useMemo(() => sortAssignments(db.assignments.filter((a) => a.clientId === clientId)), [db.assignments, clientId]);
  const byDay = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of mine) m.set(a.date, [...(m.get(a.date) ?? []), a]);
    return m;
  }, [mine]);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(start, i)), [start]);
  const myRoutines = db.templates.filter((t) => t.ownerId === user?.id);
  const weekDone = (from: number) => {
    const list = days.slice(from, from + 7).flatMap((d) => byDay.get(dayKey(d)) ?? []);
    return { total: list.length, done: list.filter((a) => isAssignmentDone(a, db.workouts)).length };
  };

  return (
    <div className="space-y-4" data-tour="plan-tab">
      <ClientPrograms clientId={clientId} />
      <ProgramSuggestions clientId={clientId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setStart((s) => addDays(s, -7))} aria-label="Previous week">
            <ChevronLeft size={16} />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setStart(weekStartOf(new Date()))}>
            Today
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setStart((s) => addDays(s, 7))} aria-label="Next week">
            <ChevronRight size={16} />
          </Button>
          <span className="ml-2 text-sm font-semibold">
            {format(days[0], "d MMM")} – {format(days[13], "d MMM yyyy")}
          </span>
        </div>
        <Button onClick={() => setAssigning(todayKey)} disabled={myRoutines.length === 0}>
          <CalendarPlus size={16} /> Assign a workout
        </Button>
      </div>

      {myRoutines.length === 0 && (
        <Notice tone="info">
          You have no routines yet. Create one on the <Link href="/workout" className="font-semibold underline">Workout</Link> page, then assign it here.
        </Notice>
      )}

      {[0, 7].map((from) => {
        const wk = weekDone(from);
        return (
          <section key={from}>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-muted">
                {from === 0 ? "Week of" : "Then week of"} {format(days[from], "d MMM")}
              </span>
              {wk.total > 0 && (
                <span className="font-semibold text-muted">
                  {wk.done} of {wk.total} done
                </span>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-7">
              {days.slice(from, from + 7).map((d) => {
                const key = dayKey(d);
                const list = byDay.get(key) ?? [];
                return (
                  <Card key={key} className={cn("flex items-start gap-2 p-2.5 md:min-h-[128px] md:flex-col", isToday(d) && "border-accent/60")}>
                    <div className="flex w-14 shrink-0 items-center justify-between gap-1 md:w-full">
                      <div>
                        <div className={cn("text-[10px] font-bold uppercase tracking-wider", isToday(d) ? "text-accent" : "text-muted")}>{format(d, "EEE")}</div>
                        <div className={cn("text-lg font-bold leading-none tabular-nums", isToday(d) && "text-accent")}>{format(d, "d")}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAssigning(key)}
                        disabled={myRoutines.length === 0}
                        aria-label={`Assign a workout on ${format(d, "EEEE d MMMM")}`}
                        className="hidden h-8 w-8 items-center justify-center rounded-lg border border-dashed border-line text-muted hover:border-accent hover:text-accent disabled:opacity-40 md:flex"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5 md:w-full md:flex-none">
                      {list.map((a) => {
                        const state = assignmentState(a, isAssignmentDone(a, db.workouts), todayKey);
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => setOpenId(a.id)}
                            className={cn("flex w-full items-start gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs font-semibold leading-tight", STATE_STYLE[state])}
                            aria-label={`${a.title}, ${STATE_LABEL[state]}`}
                          >
                            {state === "done" ? <Check size={13} className="mt-px shrink-0" /> : state === "missed" ? <AlertTriangle size={13} className="mt-px shrink-0" /> : <Dumbbell size={13} className="mt-px shrink-0" />}
                            <span className="line-clamp-2 min-w-0 flex-1 [overflow-wrap:anywhere]">{a.title}</span>
                            {a.seriesId && <Repeat size={11} className="mt-0.5 shrink-0 opacity-70" aria-label="Repeats weekly" />}
                          </button>
                        );
                      })}
                      {list.length === 0 && <span className="text-[11px] text-muted md:hidden">Rest</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAssigning(key)}
                      disabled={myRoutines.length === 0}
                      aria-label={`Assign a workout on ${format(d, "EEEE d MMMM")}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-muted hover:border-accent hover:text-accent disabled:opacity-40 md:hidden"
                    >
                      <Plus size={15} />
                    </button>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-muted">Done workouts tick themselves off when your client finishes them. Done on the gym floor instead? Open the workout and tick it off yourself.</p>

      {assigning && <AssignModal clientId={clientId} date={assigning} onClose={() => setAssigning(null)} />}
      {openId && <AssignmentModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** Pick a routine, see what the client will see, and assign it (optionally repeating weekly). */
function AssignModal({ clientId, date, onClose }: { clientId: string; date: string; onClose: () => void }) {
  const { db, user, clients } = useViewer();
  const [q, setQ] = useState("");
  const [tplId, setTplId] = useState<string>("");
  const [day, setDay] = useState(date);
  const [note, setNote] = useState("");
  const [weeks, setWeeks] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[] | null>(null);

  const routines = useMemo(
    () =>
      db.templates
        .filter((t) => t.ownerId === user?.id)
        .filter((t) => !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [db.templates, user?.id, q],
  );
  const chosen = db.templates.find((t) => t.id === tplId);
  const client = clients.find((c) => c.user.id === clientId)?.user;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await assignWorkout({ clientId, templateId: tplId, date: day, note: note.trim() || undefined, repeatWeeks: weeks });
    setBusy(false);
    if (r.error) return setError(r.error);
    if (r.skipped.length) return setSkipped(r.skipped);
    onClose();
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Assign a workout${client ? ` to ${client.name.split(" ")[0]}` : ""}`}
      footer={
        skipped ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !tplId || !day} onClick={() => void submit()}>
              <CalendarPlus size={16} /> {busy ? "Assigning…" : weeks > 0 ? `Assign for ${weeks + 1} weeks` : "Assign"}
            </Button>
          </>
        )
      }
    >
      {skipped ? (
        <Notice tone="warn">
          Assigned, except {skipped.length === 1 ? "one day" : `${skipped.length} days`} that already had three workouts: {skipped.map((s) => format(parseISO(s), "d MMM")).join(", ")}.
        </Notice>
      ) : (
        <div className="grid gap-5 md:grid-cols-[1fr_260px]">
          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Day">
                <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </Field>
              <Field label="Repeat weekly" hint={weeks > 0 ? `The same day for ${weeks + 1} weeks.` : "Just this day."}>
                <Select value={String(weeks)} onChange={(e) => setWeeks(Number(e.target.value))}>
                  <option value="0">Don&apos;t repeat</option>
                  {Array.from({ length: MAX_REPEAT_WEEKS }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n} more {n === 1 ? "week" : "weeks"}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Routine</div>
              <div className="relative mb-2">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your routines…" className="pl-9" aria-label="Search routines" />
              </div>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1" role="listbox" aria-label="Your routines">
                {routines.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={t.id === tplId}
                      aria-disabled={t.exercises.length === 0}
                      disabled={t.exercises.length === 0}
                      onClick={() => setTplId(t.id)}
                      className={cn("flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50", t.id === tplId ? "border-accent bg-accent/10" : "border-line bg-field/50 hover:border-accent/50")}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{t.name}</span>
                        {t.niche && <span className="block truncate text-[11px] text-muted">{t.niche}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{t.exercises.length === 0 ? "no exercises yet" : `${t.exercises.length} exercises`}</span>
                    </button>
                  </li>
                ))}
                {routines.length === 0 && <li className="py-4 text-center text-xs text-muted">No routine matches.</li>}
              </ul>
            </div>

            <Field label="Note for your client (optional)" hint="Shown above the workout, for example a cue or a target.">
              <Textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Keep the first set light, we are building up." />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
          </div>

          <div className="order-first md:order-none">
            <div className="mb-2 text-center text-[11px] font-bold uppercase tracking-wider text-muted">What your client sees</div>
            <PhonePreview title={chosen?.name ?? ""} note={note.trim()} exercises={chosen?.exercises ?? []} />
          </div>
        </div>
      )}
    </Modal>
  );
}

/** One assigned workout: what it is, its state, and the things a coach can do with it. */
function AssignmentModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { db } = useViewer();
  const now = useNow(60_000);
  const a = db.assignments.find((x) => x.id === id);
  if (!a) return <Gone onClose={onClose} />;
  return <AssignmentBody key={a.id} a={a} today={dayKey(now)} onClose={onClose} />;
}

function Gone({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Assigned workout" footer={<Button onClick={onClose}>Close</Button>}>
      <p className="text-sm text-muted">This workout is no longer assigned.</p>
    </Modal>
  );
}

function AssignmentBody({ a, today, onClose }: { a: Assignment; today: string; onClose: () => void }) {
  const { db } = useViewer();
  const done = isAssignmentDone(a, db.workouts);
  const state = assignmentState(a, done, today);
  const result = resultOf(a, db.workouts);
  const later = a.seriesId ? db.assignments.filter((x) => x.seriesId === a.seriesId && x.date > a.date).length : 0;
  const [note, setNote] = useState(a.note);
  const [moveTo, setMoveTo] = useState(a.date);
  const [copyTo, setCopyTo] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const run = async (fn: () => Promise<string | null>, ok: string, close = false) => {
    setBusy(true);
    setMsg(null);
    const err = await fn();
    setBusy(false);
    if (err) return setMsg({ tone: "error", text: err });
    if (close) return onClose();
    setMsg({ tone: "success", text: ok });
  };

  return (
    <>
    <Modal
      open
      wide
      onClose={onClose}
      title={a.title}
      footer={
        <>
          <Button variant="danger" onClick={() => (later > 0 ? setAsking(true) : void run(() => removeAssignment(a.id), "", true))} disabled={busy}>
            <Trash2 size={16} /> Delete
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={STATE_STYLE[state]}>{STATE_LABEL[state]}</Badge>
            <span className="text-sm font-semibold">{format(parseISO(a.date), "EEEE d MMMM yyyy")}</span>
            {a.seriesId && (
              <Badge>
                <Repeat size={11} /> Weekly
              </Badge>
            )}
          </div>

          {result && (
            <Link href={`/workout/${result.id}`} className="block rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm font-semibold text-success">
              Finished {format(parseISO(result.startedAt), "EEE d MMM, h:mm a")}. View the result →
            </Link>
          )}
          {a.doneManually && !result && <Notice tone="success">You ticked this off by hand.</Notice>}

          <ExerciseRows exercises={a.exercises} />

          <Field label="Note for your client">
            <Textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {note.trim() !== a.note.trim() && (
            <div className="flex justify-end">
              <Button size="sm" disabled={busy} onClick={() => void run(() => setAssignmentNote(a.id, note.trim()), "Note saved.")}>
                Save note
              </Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Move to another day">
              <div className="flex gap-2">
                <Input type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
                <Button variant="secondary" disabled={busy || moveTo === a.date || !moveTo} onClick={() => void run(() => moveAssignment(a.id, moveTo), "Moved.")}>
                  Move
                </Button>
              </div>
            </Field>
            <Field label="Copy to another day">
              <div className="flex gap-2">
                <Input type="date" value={copyTo} onChange={(e) => setCopyTo(e.target.value)} />
                <Button
                  variant="secondary"
                  disabled={busy || !copyTo}
                  onClick={() =>
                    void run(async () => {
                      const r = await copyAssignment(a.id, [copyTo]);
                      return r.error;
                    }, "Copied.")
                  }
                >
                  <Copy size={14} /> Copy
                </Button>
              </div>
            </Field>
          </div>

          {!result && (
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => setAssignmentDone(a.id, !a.doneManually), a.doneManually ? "Tick removed." : "Ticked off.")}>
              <Check size={16} /> {a.doneManually ? "Remove my tick" : "Mark as done"}
            </Button>
          )}
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        </div>
        <div className="order-first md:order-none">
          <PhonePreview title={a.title} note={a.note} exercises={a.exercises} />
        </div>
      </div>
    </Modal>

      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title="Delete a repeating workout"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void run(() => removeAssignment(a.id, "one"), "", true)}>
              Only this one
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void run(() => removeAssignment(a.id, "future"), "", true)}>
              This and the next {later}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">This workout repeats every week. Delete just this day, or this day and the {later} that come after it?</p>
      </Modal>
    </>
  );
}
