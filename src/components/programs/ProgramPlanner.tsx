"use client";

import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Loader2, Plus, RotateCcw, Send, Sparkles, Trash2, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExercisePicker } from "@/components/ExerciseLibrary";
import { NumberInput } from "@/components/NumberInput";
import { Badge, Button, Card, ConfirmDialog, Field, IconButton, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { copyWeek, describeProgram, MAX_EDITS, MAX_PER_DAY, moveSlot, sortSlots, type Program, type ProgramSlot } from "@/lib/programs";
import { api } from "@/lib/store";
import type { TemplateExercise } from "@/lib/types";
import { cn, fmtWeight, fromKg, round, toKg, uid, weightUnit } from "@/lib/utils";
import { AssignProgramModal } from "./AssignProgramModal";
import { SOURCE_LABEL } from "./ProgramsHome";

interface Enrolment {
  id: string;
  programId: string;
  programName: string;
  clientId: string;
  startDate: string;
  endDate: string;
  liveSync: boolean;
  behind: boolean;
}

const SUGGESTIONS = ["Make week 3 easier", "Swap the barbell exercises for dumbbell ones", "Add a deload in week 4", "Take one set off every exercise"];

/**
 * The program planner: one week at a time (seven days on a wide screen, a list of days on a phone), with every workout editable, drag and
 * drop between days, copy a week, chat edits with the AI, and who is on the program. Changes are saved with the Save button; clients on
 * Live Sync are brought up to date when you save.
 */
export function ProgramPlanner({ id, base, solo }: { id: string; base: string; solo: boolean }) {
  const router = useRouter();
  const { exMap, isMinor } = useViewer();
  const [server, setServer] = useState<Program | null>(null);
  const [draft, setDraft] = useState<Program | null>(null);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [week, setWeek] = useState(1);
  const [editing, setEditing] = useState<ProgramSlot | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [assign, setAssign] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [ending, setEnding] = useState<Enrolment | null>(null);
  const [chat, setChat] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatNotes, setChatNotes] = useState<string[]>([]);

  const load = useCallback(async () => {
    const r = await api<{ program: Program; enrolments: Enrolment[] }>(`/api/programs/${id}`);
    if (r.ok && r.data) {
      setServer(r.data.program);
      setDraft(r.data.program);
      setEnrolments(r.data.enrolments);
    } else setError(r.error ?? "Couldn't open that program.");
  }, [id]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<{ program: Program; enrolments: Enrolment[] }>(`/api/programs/${id}`);
      if (!alive) return;
      if (r.ok && r.data) {
        setServer(r.data.program);
        setDraft(r.data.program);
        setEnrolments(r.data.enrolments);
      } else setError(r.error ?? "Couldn't open that program.");
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const dirty = useMemo(() => {
    if (!server || !draft) return false;
    return server.name !== draft.name || server.description !== draft.description || server.weeks !== draft.weeks || JSON.stringify(server.slots) !== JSON.stringify(draft.slots);
  }, [server, draft]);

  if (error) {
    return (
      <div className="space-y-3">
        <Notice tone="error">{error}</Notice>
        <Link href={base} className="text-sm font-semibold text-accent">
          ← Back to programs
        </Link>
      </div>
    );
  }
  if (!draft || !server) return <p className="text-sm text-muted">Loading…</p>;

  const slotsOf = (w: number, d: number) => draft.slots.filter((s) => s.week === w && s.day === d);
  const setSlots = (slots: ProgramSlot[]) => setDraft({ ...draft, slots: sortSlots(slots) });

  const save = async () => {
    setSaving(true);
    setFlash(null);
    const r = await api<{ program: Program; synced: number }>(`/api/programs/${id}`, { method: "PUT", body: { name: draft.name, description: draft.description, weeks: draft.weeks, slots: draft.slots } });
    setSaving(false);
    if (!r.ok || !r.data) return setFlash({ tone: "error", text: r.error ?? "Couldn't save." });
    setServer(r.data.program);
    setDraft(r.data.program);
    setFlash({ tone: "success", text: r.data.synced > 0 ? `Saved. ${r.data.synced} client${r.data.synced === 1 ? "" : "s"} on Live Sync updated.` : "Saved." });
    if (week > r.data.program.weeks) setWeek(r.data.program.weeks);
  };

  const onDrop = (d: number) => {
    if (!dragId) return;
    const moved = moveSlot(draft.slots, dragId, week, d);
    setDragId(null);
    if (!moved) return setFlash({ tone: "error", text: `A day holds at most ${MAX_PER_DAY} workouts.` });
    setSlots(moved);
  };

  const sendChat = async (text: string) => {
    if (dirty) return setFlash({ tone: "info", text: "Save your changes first, then ask the AI to change the program." });
    setChatBusy(true);
    setFlash(null);
    const r = await api<{ program: Program; notes: string[]; skipped: string[] }>(`/api/programs/${id}/edit`, { body: { instruction: text } });
    setChatBusy(false);
    if (!r.ok || !r.data) return setFlash({ tone: "error", text: r.error ?? "That didn't work." });
    setServer(r.data.program);
    setDraft(r.data.program);
    setChatNotes([...r.data.notes, ...r.data.skipped]);
    setChat("");
  };
  const undo = async () => {
    setChatBusy(true);
    const r = await api<{ program: Program }>(`/api/programs/${id}/edit`, { body: { undo: true } });
    setChatBusy(false);
    if (!r.ok || !r.data) return setFlash({ tone: "error", text: r.error ?? "Couldn't undo." });
    setServer(r.data.program);
    setDraft(r.data.program);
    setChatNotes(["Put the program back as it was."]);
  };

  const remove = async () => {
    const r = await api(`/api/programs/${id}`, { method: "DELETE" });
    if (r.ok) router.push(base);
    else setFlash({ tone: "error", text: r.error ?? "Couldn't delete." });
  };
  const duplicate = async () => {
    const r = await api<{ program: Program }>(`/api/programs/${id}/duplicate`, { method: "POST", body: {} });
    if (r.ok && r.data) router.push(`${base}/${r.data.program.id}`);
    else setFlash({ tone: "error", text: r.error ?? "Couldn't duplicate." });
  };
  const endIt = async (removeFuture: boolean) => {
    if (!ending) return;
    const r = await api<{ removed: number }>(`/api/programs/enrolments/${ending.id}${removeFuture ? "?remove=1" : ""}`, { method: "DELETE" });
    setEnding(null);
    if (r.ok) {
      setFlash({ tone: "success", text: removeFuture ? `Ended, and ${r.data?.removed ?? 0} coming workouts were removed.` : "Ended. The workouts already given stay." });
      await load();
    } else setFlash({ tone: "error", text: r.error ?? "Couldn't end it." });
  };

  const weekSlots = draft.slots.filter((s) => s.week === week);
  const edits = draft.edits;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={base} className="flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:bg-field" aria-label="Back to programs">
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <Input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Program name" className="h-11 text-lg font-bold" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge>{SOURCE_LABEL[draft.source]}</Badge>
        {draft.goal && <Badge>{draft.goal}</Badge>}
        {draft.level && <Badge>{draft.level}</Badge>}
        {draft.gentle && <Badge className="border-success/30 bg-success/15 text-success">Gentle</Badge>}
        {draft.minor && <Badge className="border-pr/30 bg-pr/15 text-pr">Built for under 18</Badge>}
        <span>{describeProgram(draft)}</span>
      </div>
      <Textarea value={draft.description} rows={2} maxLength={600} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="A short description (optional)" aria-label="Description" className="text-sm" />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </Button>
        <Button variant="secondary" onClick={() => (dirty ? setFlash({ tone: "info", text: "Save your changes first, then assign." }) : setAssign(true))} disabled={draft.slots.length === 0}>
          <UserPlus size={16} /> {solo ? "Start this program" : "Assign to a client"}
        </Button>
        <Button variant="secondary" onClick={() => setCopyOpen(true)} disabled={draft.slots.length === 0}>
          <Copy size={16} /> Copy week {week}
        </Button>
        <Button variant="ghost" onClick={() => void duplicate()}>
          Duplicate
        </Button>
        <Button variant="ghost" className="text-danger" onClick={() => setRemoving(true)}>
          <Trash2 size={16} /> Delete
        </Button>
      </div>
      {flash && <Notice tone={flash.tone === "error" ? "error" : flash.tone === "success" ? "success" : "info"}>{flash.text}</Notice>}

      {/* Weeks */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Weeks">
          {Array.from({ length: draft.weeks }, (_, i) => i + 1).map((w) => (
            <button
              key={w}
              role="tab"
              aria-selected={week === w}
              onClick={() => setWeek(w)}
              className={cn("min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold", week === w ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}
            >
              Week {w}
              {draft.slots.some((s) => s.week === w) ? "" : " ·"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          Weeks
          <div className="w-24">
            <NumberInput label="Weeks in the program" min={1} max={12} value={draft.weeks} onChange={(v) => v && setDraft({ ...draft, weeks: v, slots: draft.slots.filter((s) => s.week <= v) })} compact />
          </div>
        </div>
      </div>

      {/* Days */}
      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7" data-planner-week={week}>
        {Array.from({ length: 7 }, (_, i) => i + 1).map((d) => {
          const here = slotsOf(week, d);
          return (
            <div
              key={d}
              onDragOver={(e) => dragId && e.preventDefault()}
              onDrop={() => onDrop(d)}
              className={cn("min-h-24 rounded-2xl border border-line bg-surface p-2", dragId && "border-dashed border-accent/50")}
              data-day={d}
            >
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Day {d}</span>
                {here.length < MAX_PER_DAY && (
                  <IconButton label={`Add a workout to day ${d}`} className="h-8 w-8" onClick={() => setEditing({ id: uid("ps"), week, day: d, title: "", exercises: [] })}>
                    <Plus size={16} />
                  </IconButton>
                )}
              </div>
              <div className="space-y-1.5">
                {here.map((s) => (
                  <button
                    key={s.id}
                    draggable
                    onDragStart={() => setDragId(s.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setEditing(s)}
                    className="block w-full rounded-xl border border-line bg-field p-2 text-left hover:border-accent/50"
                    data-slot={s.id}
                  >
                    <div className="truncate text-sm font-bold">{s.title || "Workout"}</div>
                    <ul className="mt-0.5 space-y-0.5 text-[11px] text-muted">
                      {s.exercises.slice(0, 3).map((e, i) => (
                        <li key={i} className="truncate">
                          {exMap.get(e.exerciseId)?.name ?? "Exercise"}
                        </li>
                      ))}
                      {s.exercises.length > 3 && <li>+ {s.exercises.length - 3} more</li>}
                    </ul>
                  </button>
                ))}
                {here.length === 0 && <div className="px-1 py-2 text-[11px] text-muted md:py-5">Rest</div>}
              </div>
            </div>
          );
        })}
      </div>
      {weekSlots.length === 0 && <p className="text-sm text-muted">Nothing in week {week} yet. Tap + on a day to add a workout, or copy another week.</p>}

      {/* Chat edit */}
      <Card className="space-y-3 p-4" data-planner="chat">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <Sparkles size={16} className="text-accent" /> Change it by asking
          </h3>
          <span className="text-xs text-muted">
            {edits} of {MAX_EDITS} chat edits used
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => setChat(s)} className="min-h-10 rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-ink">
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (chat.trim()) void sendChat(chat.trim());
          }}
        >
          <Textarea value={chat} rows={2} maxLength={300} onChange={(e) => setChat(e.target.value)} placeholder="e.g. make week 3 easier, or no barbell work" aria-label="Tell the AI what to change" className="flex-1 text-sm" />
          <Button type="submit" disabled={chatBusy || chat.trim().length < 3 || edits >= MAX_EDITS} aria-label="Send">
            {chatBusy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </Button>
        </form>
        {chatNotes.length > 0 && (
          <ul className="space-y-1 text-sm">
            {chatNotes.map((n) => (
              <li key={n} className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 shrink-0 text-success" /> {n}
              </li>
            ))}
          </ul>
        )}
        {draft.canUndo && (
          <Button variant="ghost" size="sm" disabled={chatBusy} onClick={() => void undo()}>
            <RotateCcw size={14} /> Undo the last chat edit
          </Button>
        )}
        {isMinor && <p className="text-xs text-muted">AI features are not available under 18.</p>}
      </Card>

      {/* Who is on it */}
      {!solo && (
        <section className="space-y-2" data-planner="enrolments">
          <h3 className="text-sm font-bold">On this program</h3>
          {enrolments.length === 0 ? (
            <p className="text-sm text-muted">Nobody yet. Press “Assign to a client” to start someone.</p>
          ) : (
            <ul className="space-y-2">
              {enrolments.map((e) => (
                <EnrolmentRow key={e.id} e={e} onEnd={() => setEnding(e)} />
              ))}
            </ul>
          )}
        </section>
      )}
      {solo && enrolments.length > 0 && (
        <Notice tone="success">
          Running now: {format(parseISO(enrolments[0].startDate), "d MMM")} to {format(parseISO(enrolments[0].endDate), "d MMM yyyy")}. Your workouts are on your Workout page and calendar.{" "}
          <button className="font-semibold underline" onClick={() => setEnding(enrolments[0])}>
            Stop it
          </button>
        </Notice>
      )}

      {editing && (
        <SlotEditor
          key={editing.id}
          slot={editing}
          isNew={!draft.slots.some((s) => s.id === editing.id)}
          weeks={draft.weeks}
          onClose={() => setEditing(null)}
          onSave={(s) => {
            const exists = draft.slots.some((x) => x.id === s.id);
            const others = draft.slots.filter((x) => x.id !== s.id);
            if (others.filter((x) => x.week === s.week && x.day === s.day).length >= MAX_PER_DAY) {
              setFlash({ tone: "error", text: `Week ${s.week}, day ${s.day} already has ${MAX_PER_DAY} workouts.` });
              return false;
            }
            setSlots(exists ? draft.slots.map((x) => (x.id === s.id ? s : x)) : [...draft.slots, s]);
            setWeek(s.week);
            setEditing(null);
            return true;
          }}
          onDelete={() => {
            setSlots(draft.slots.filter((x) => x.id !== editing.id));
            setEditing(null);
          }}
        />
      )}
      {copyOpen && (
        <CopyWeekModal
          from={week}
          weeks={draft.weeks}
          onClose={() => setCopyOpen(false)}
          onCopy={(to) => {
            setSlots(copyWeek(draft.slots, week, to));
            setCopyOpen(false);
            setFlash({ tone: "info", text: `Week ${week} copied to week${to.length === 1 ? "" : "s"} ${to.join(", ")}. Press Save to keep it.` });
          }}
        />
      )}
      {assign && (
        <AssignProgramModal
          program={{ id, name: draft.name, weeks: draft.weeks, slotCount: draft.slots.length }}
          solo={solo}
          onClose={() => setAssign(false)}
          onDone={() => void load()}
        />
      )}
      <ConfirmDialog
        open={removing}
        title="Delete this program?"
        message={enrolments.length > 0 ? `${enrolments.length} client${enrolments.length === 1 ? " is" : "s are"} on it. Their workouts stay, but they stop following the program.` : "This can't be undone."}
        confirmLabel="Delete"
        danger
        onConfirm={() => void remove()}
        onClose={() => setRemoving(false)}
      />
      {ending && (
        <Modal
          open
          onClose={() => setEnding(null)}
          title={solo ? "Stop this program?" : "End this program for the client?"}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEnding(null)}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={() => void endIt(false)}>
                End, keep the coming workouts
              </Button>
              <Button className="bg-danger text-on-danger" onClick={() => void endIt(true)}>
                End and remove the coming workouts
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">Workouts already done or in the past always stay. Choose what happens to the ones still to come.</p>
        </Modal>
      )}
    </div>
  );
}

function EnrolmentRow({ e, onEnd }: { e: Enrolment; onEnd: () => void }) {
  const { clients } = useViewer();
  const name = clients.find((c) => c.user.id === e.clientId)?.user.name ?? "Client";
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm" data-enrolment={e.id}>
      <Link href={`/clients/${e.clientId}`} className="min-w-0 flex-1 font-semibold hover:underline">
        {name}
      </Link>
      <span className="text-xs text-muted">
        {format(parseISO(e.startDate), "d MMM")} to {format(parseISO(e.endDate), "d MMM yyyy")}
      </span>
      <Badge className={cn(e.liveSync ? "border-accent/30 bg-accent/15 text-accent" : "")}>{e.liveSync ? "Live Sync" : "Fixed copy"}</Badge>
      {e.behind && <Badge className="border-pr/30 bg-pr/15 text-pr">Program changed since</Badge>}
      <Button size="sm" variant="ghost" onClick={onEnd}>
        <X size={14} /> End
      </Button>
    </li>
  );
}

/* ---------------- Copy a week ---------------- */
function CopyWeekModal({ from, weeks, onClose, onCopy }: { from: number; weeks: number; onClose: () => void; onCopy: (to: number[]) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const others = Array.from({ length: weeks }, (_, i) => i + 1).filter((w) => w !== from);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Copy week ${from}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={picked.length === 0} onClick={() => onCopy(picked)}>
            Copy
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">Pick the weeks to copy it onto. Anything already in those weeks is replaced.</p>
      {others.length === 0 ? (
        <p className="text-sm text-muted">This program has only one week. Add more weeks first.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink" onClick={() => setPicked(picked.length === others.length ? [] : others)}>
            {picked.length === others.length ? "Clear" : "All other weeks"}
          </button>
          {others.map((w) => (
            <button key={w} type="button" aria-pressed={picked.includes(w)} onClick={() => setPicked((l) => (l.includes(w) ? l.filter((x) => x !== w) : [...l, w]))} className={cn("min-h-10 rounded-full border px-4 text-sm font-semibold", picked.includes(w) ? "border-accent bg-accent/15 text-accent" : "border-line text-muted")}>
              Week {w}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- One workout ---------------- */
function SlotEditor({ slot, isNew, weeks, onClose, onSave, onDelete }: { slot: ProgramSlot; isNew: boolean; weeks: number; onClose: () => void; onSave: (s: ProgramSlot) => boolean; onDelete: () => void }) {
  const { exMap, unit } = useViewer();
  const [title, setTitle] = useState(slot.title);
  const [note, setNote] = useState(slot.note ?? "");
  const [week, setWeek] = useState(slot.week);
  const [day, setDay] = useState(slot.day);
  const [items, setItems] = useState<TemplateExercise[]>(slot.exercises);
  const [picker, setPicker] = useState(false);

  const patch = (i: number, p: Partial<TemplateExercise>) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const swap = (i: number, d: -1 | 1) =>
    setItems((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const n = [...l];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={isNew ? "New workout" : "Edit workout"}
        wide
        footer={
          <>
            {!isNew && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={onDelete}>
                <Trash2 size={16} /> Delete
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={items.length === 0} onClick={() => onSave({ ...slot, title: title.trim() || `Week ${week} · Day ${day}`, note: note.trim() || undefined, week, day, exercises: items })}>
              Done
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Workout name">
            <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Upper body A" autoFocus={isNew} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Week">
              <Select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
                {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>
                    Week {w}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Day">
              <Select value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {Array.from({ length: 7 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    Day {d}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Note for the client" hint="Optional.">
            <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Keep the first set light" />
          </Field>

          <div className="space-y-2">
            {items.map((it, i) => {
              const ex = exMap.get(it.exerciseId);
              const timed = ex?.type === "DURATION_DISTANCE" || ex?.type === "DURATION_ONLY" || !!it.durationSec;
              return (
                <div key={`${it.exerciseId}-${i}`} className="rounded-xl border border-line bg-field p-3" data-exercise-row>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-semibold">{ex?.name ?? "Unknown exercise"}</div>
                    <div className="flex shrink-0">
                      <IconButton label="Move up" onClick={() => swap(i, -1)} className="h-9 w-9">
                        <ArrowUp size={16} />
                      </IconButton>
                      <IconButton label="Move down" onClick={() => swap(i, 1)} className="h-9 w-9">
                        <ArrowDown size={16} />
                      </IconButton>
                      <IconButton label="Remove" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} className="h-9 w-9">
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>
                  {timed ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Field label="Sets">
                        <NumberInput label="Sets" min={1} max={10} value={it.sets} onChange={(v) => patch(i, { sets: v ?? it.sets })} />
                      </Field>
                      <Field label="Minutes">
                        <NumberInput label="Minutes" decimals={2} step={0.5} allowEmpty value={it.durationSec ? round(it.durationSec / 60, 2) : undefined} onChange={(v) => patch(i, { durationSec: v && v > 0 ? Math.round(v * 60) : undefined })} />
                      </Field>
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Field label="Sets">
                        <NumberInput label="Sets" min={1} max={10} value={it.sets} onChange={(v) => patch(i, { sets: v ?? it.sets })} />
                      </Field>
                      <Field label="Min reps">
                        <NumberInput label="Min reps" value={it.repMin} onChange={(v) => patch(i, { repMin: v ?? it.repMin, repMax: Math.max(it.repMax, v ?? it.repMin) })} />
                      </Field>
                      <Field label="Max reps">
                        <NumberInput label="Max reps" value={it.repMax} onChange={(v) => patch(i, { repMax: Math.max(v ?? it.repMax, it.repMin) })} />
                      </Field>
                      <Field label={`Weight (${weightUnit(unit)})`}>
                        <NumberInput label="Weight" decimals={1} step={2.5} allowEmpty placeholder="Optional" value={it.weight ? round(fromKg(it.weight, unit), 1) : undefined} onChange={(v) => patch(i, { weight: v && v > 0 ? Math.round(toKg(v, unit) * 100) / 100 : undefined })} />
                      </Field>
                    </div>
                  )}
                  <Input value={it.notes ?? ""} maxLength={200} onChange={(e) => patch(i, { notes: e.target.value || undefined })} placeholder="Note (tempo, rest, cues…)" aria-label="Exercise note" className="mt-2 h-10 text-sm" />
                </div>
              );
            })}
            {items.length === 0 && <p className="py-4 text-center text-sm text-muted">No exercises yet. Add some below, or create your own if one is missing.</p>}
          </div>
          <Button variant="outline" className="w-full" onClick={() => setPicker(true)}>
            <Plus size={16} /> Add exercises
          </Button>
          {items.some((i) => i.weight) && <p className="text-xs text-muted">Weights are shown in {weightUnit(unit)}; first set {fmtWeight(items.find((i) => i.weight)?.weight ?? 0, unit)}.</p>}
        </div>
      </Modal>
      <ExercisePicker
        open={picker}
        onClose={() => setPicker(false)}
        onConfirm={(ids) => setItems((l) => [...l, ...ids.map((id) => ({ exerciseId: id, sets: exMap.get(id)?.type === "DURATION_DISTANCE" || exMap.get(id)?.type === "DURATION_ONLY" ? 1 : 3, repMin: 8, repMax: 12, ...(exMap.get(id)?.type === "DURATION_ONLY" || exMap.get(id)?.type === "DURATION_DISTANCE" ? { repMin: 0, repMax: 0, durationSec: 60 } : {}) }))])}
      />
    </>
  );
}
