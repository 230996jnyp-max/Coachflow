"use client";

import { format, parseISO } from "date-fns";
import { ArrowLeft, Ban, CalendarClock, Dumbbell, MapPin, Pencil, Plus, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ExercisePicker } from "@/components/ExerciseLibrary";
import { LocationPill, MiniMap } from "@/components/LocationPill";
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, Notice, SectionTitle, Select, Textarea } from "@/components/ui";
import { directionsUrl } from "@/lib/gyms";
import { useViewer } from "@/lib/hooks";
import { atTime, ymd } from "@/lib/scheduling";
import {
  addClassMember,
  cancelClass,
  editClass,
  refreshGroups,
  refreshTraining,
  removeClassMember,
  startClassWorkout,
  unshareSession,
} from "@/lib/store";
import type { GroupSession } from "@/lib/types";
import { ApprovalCard, classLocation, classTime, classTitle, GroupBadge, SpotsPill } from "./groupUi";
import { RollCallPanel } from "@/components/attendance/Attendance";
import { ClientActions, GroupCreditsCard } from "./ClassList";
import { LiveGrid } from "./LiveGrid";

export function ClassDetail({ id }: { id: string }) {
  const { db, isTrainer, user } = useViewer();
  const g = db.groups.find((x) => x.id === id);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let alive = true;
    void refreshGroups().then(() => alive && setChecked(true));
    return () => {
      alive = false;
    };
  }, [id]);

  if (!user) return null;
  if (!g) {
    return checked ? (
      <EmptyState title="Class not found" hint="It may have been cancelled or removed." action={<Link href={isTrainer ? "/schedule" : "/book"} className="text-sm font-semibold text-accent">Back to the schedule</Link>} />
    ) : (
      <div className="py-16 text-center text-sm text-muted">Loading…</div>
    );
  }
  return isTrainer ? <CoachView g={g} /> : <ClientView g={g} />;
}

function Header({ g, back }: { g: GroupSession; back: string }) {
  const { db } = useViewer();
  const loc = classLocation(g, db.gyms);
  return (
    <Card className="space-y-3 p-4">
      <Link href={back} className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
        <ArrowLeft size={14} /> Back
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{classTitle(g)}</h1>
        <GroupBadge g={g} />
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2 text-muted">
          <CalendarClock size={15} /> {format(parseISO(g.start), "EEEE d MMMM yyyy")} · {classTime(g)}
        </div>
        <div className="flex items-center gap-2 text-muted">
          <MapPin size={15} /> <LocationPill label={loc.label} href={loc.href} />
        </div>
        {g.place?.address && <div className="pl-[23px] text-xs text-muted">{g.place.address}</div>}
      </div>
      {g.place && <MiniMap place={g.place} href={directionsUrl({ place: g.place })} />}
      {g.notes && <p className="rounded-xl bg-field p-3 text-sm">{g.notes}</p>}
    </Card>
  );
}

/* ---------------- Client ---------------- */
function ClientView({ g }: { g: GroupSession }) {
  const { db, user } = useViewer();
  const [error, setError] = useState<string | null>(null);
  const workoutId = user ? `gw_${g.id}_${user.id}` : "";
  const workout = db.workouts.find((w) => w.id === workoutId);
  const toAnswer = db.groupRequests.filter((r) => r.needsMe && r.groupId === g.id);
  const isOwner = g.mine?.role === "OWNER";
  const partners = Math.max(0, g.confirmed - (isOwner ? 1 : 0));

  return (
    <div className="space-y-4">
      <Header g={g} back="/book" />
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SpotsPill g={g} />
          {g.mine?.status === "WAITLIST" && <Badge className="border-pr/30 bg-pr/15 text-pr">Waitlist #{g.mine.position}</Badge>}
          {g.mine?.status === "CONFIRMED" && <Badge className="border-success/30 bg-success/15 text-success">You’re in</Badge>}
        </div>
        <ClientActions g={g} />
        {g.status === "OPEN" && !isOwner && <p className="text-xs text-muted">1 group class credit is used when the class is completed. Leaving costs nothing.</p>}
        {isOwner && g.status === "OPEN" && (
          <>
            <p className="text-xs text-muted">
              {partners === 0 ? "You’ve opened this session to partners. Anyone who asks needs approval from you and your coach." : `${partners} partner${partners === 1 ? " has" : "s have"} joined your session.`}
            </p>
            {partners === 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const err = await unshareSession(g.id);
                  if (err) setError(err);
                }}
              >
                Stop sharing this session
              </Button>
            )}
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </Card>

      {toAnswer.map((r) => (
        <ApprovalCard key={r.id} req={r} group={g} />
      ))}

      {g.workoutStartedAt && g.mine?.status === "CONFIRMED" && g.status === "OPEN" && (
        <Card className="flex items-center justify-between gap-3 border-accent/40 p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold">
              <Dumbbell size={16} className="text-accent" /> Group workout is live
            </div>
            <div className="text-xs text-muted">Your own weights and reps are ready — log your sets as you go.</div>
          </div>
          {workout ? (
            <Link href={`/workout/${workout.id}`}>
              <Button>Open my workout</Button>
            </Link>
          ) : (
            <Button variant="secondary" onClick={() => refreshTraining(true)}>
              Load workout
            </Button>
          )}
        </Card>
      )}
      <GroupCreditsCard />
    </div>
  );
}

/* ---------------- Coach ---------------- */
function CoachView({ g }: { g: GroupSession }) {
  const { db, clients } = useViewer();
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
    return err;
  };
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? "Client";
  const members = g.members ?? [];
  const going = members.filter((m) => m.status === "CONFIRMED" || m.status === "ATTENDED");
  const waiting = members.filter((m) => m.status === "WAITLIST").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const open = g.status === "OPEN";
  const toAnswer = db.groupRequests.filter((r) => r.needsMe && r.groupId === g.id);
  const reservedFor = (id: string) => db.groups.filter((x) => x.status === "OPEN" && x.members?.some((m) => m.clientId === id && m.status === "CONFIRMED" && m.role === "MEMBER")).length;
  const addable = clients.filter((c) => !c.profile.archived && !members.some((m) => m.clientId === c.user.id && (m.status === "CONFIRMED" || m.status === "WAITLIST")));

  return (
    <div className="space-y-6">
      <Header g={g} back="/schedule" />

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <Users size={15} /> {g.confirmed} of {g.capacity} spots taken{g.waitlist > 0 ? ` · ${g.waitlist} on the waitlist` : ""}
          </span>
          {g.templateName && <Badge>{g.templateName}</Badge>}
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            {!g.workoutStartedAt ? (
              <Button onClick={() => setStartOpen(true)} disabled={going.length === 0}>
                <Dumbbell size={16} /> Start group workout
              </Button>
            ) : (
              <Badge className="border-accent/30 bg-accent/15 text-accent">Workout live since {format(parseISO(g.workoutStartedAt), "h:mm a")}</Badge>
            )}
            {g.kind === "CLASS" && (
              <Button variant="secondary" onClick={() => setEdit(true)}>
                <Pencil size={16} /> Edit
              </Button>
            )}
            {g.kind === "CLASS" && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                <Ban size={16} /> Cancel class
              </Button>
            )}
          </div>
        )}
        {open && going.length === 0 && <p className="text-xs text-muted">Add or wait for attendees to start the workout.</p>}
        {error && <Notice tone="error">{error}</Notice>}
      </Card>

      {toAnswer.map((r) => (
        <ApprovalCard key={r.id} req={r} group={g} />
      ))}

      {(open || g.status === "COMPLETED") && going.length > 0 && <RollCallPanel target={{ kind: g.kind === "SHARED" && g.bookingId ? "BOOKING" : "GROUP", id: g.kind === "SHARED" && g.bookingId ? g.bookingId : g.id }} />}

      {g.workoutStartedAt && (
        <section>
          <SectionTitle>Multi-client live grid</SectionTitle>
          <LiveGrid g={g} />
        </section>
      )}

      <section>
        <SectionTitle>Roster</SectionTitle>
        <Card className="divide-y divide-line p-0">
          {going.length === 0 && <div className="p-4 text-sm text-muted">No one has booked yet.</div>}
          {going.map((m) => (
            <div key={m.clientId} className="flex items-center gap-3 p-3">
              <Avatar name={name(m.clientId)} size={34} />
              <div className="min-w-0 flex-1">
                <Link href={`/clients/${m.clientId}`} className="truncate text-sm font-semibold hover:underline">
                  {name(m.clientId)}
                </Link>
                <div className="text-xs text-muted">
                  {m.role === "OWNER" ? "Session owner" : m.status === "ATTENDED" ? "Attended" : "Booked"} · {db.clients.find((c) => c.id === m.clientId)?.groupClassCredits ?? 0} group credits
                </div>
              </div>
              {open && m.role !== "OWNER" && (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => removeClassMember(g.id, m.clientId))} aria-label={`Remove ${name(m.clientId)}`}>
                  <UserMinus size={14} /> Remove
                </Button>
              )}
            </div>
          ))}
        </Card>
        {waiting.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">Waitlist</div>
            <Card className="divide-y divide-line p-0">
              {waiting.map((m) => (
                <div key={m.clientId} className="flex items-center gap-3 p-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pr/15 text-xs font-bold text-pr">#{m.position}</span>
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold">{name(m.clientId)}</div>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => removeClassMember(g.id, m.clientId))}>
                    <Trash2 size={14} /> Remove
                  </Button>
                </div>
              ))}
            </Card>
          </div>
        )}
        {open && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <Field label="Add a client">
                <Select value={addId} onChange={(e) => setAddId(e.target.value)}>
                  <option value="">Choose a client…</option>
                  {addable.map((c) => (
                    <option key={c.user.id} value={c.user.id}>
                      {c.user.name} — {c.profile.groupClassCredits - reservedFor(c.user.id)} credits free
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button
              disabled={!addId || busy}
              onClick={async () => {
                const err = await run(() => addClassMember(g.id, addId));
                if (!err) setAddId("");
              }}
            >
              <UserPlus size={16} /> Add
            </Button>
          </div>
        )}
      </section>

      <EditClassModal g={g} open={edit} onClose={() => setEdit(false)} />
      <StartWorkoutModal g={g} open={startOpen} onClose={() => setStartOpen(false)} />
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this class?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Keep class
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                const err = await run(() => cancelClass(g.id, reason.trim()));
                if (!err) setCancelOpen(false);
              }}
            >
              Cancel class
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">Everyone booked or waitlisted is notified. No group credits are used.</p>
          <Field label="Reason (optional)">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Coach is unwell" maxLength={200} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------- Edit ---------------- */
function EditClassModal({ g, open, onClose }: { g: GroupSession; open: boolean; onClose: () => void }) {
  return open ? <EditForm key={g.id + g.start} g={g} onClose={onClose} /> : null;
}

function EditForm({ g, onClose }: { g: GroupSession; onClose: () => void }) {
  const { db, user } = useViewer();
  const templates = db.templates.filter((t) => t.ownerId === user?.id && t.exercises.length > 0);
  const [title, setTitle] = useState(g.title);
  const [date, setDate] = useState(() => ymd(parseISO(g.start)));
  const [time, setTime] = useState(() => format(parseISO(g.start), "HH:mm"));
  const [minutes, setMinutes] = useState(() => Math.round((parseISO(g.end).getTime() - parseISO(g.start).getTime()) / 60000));
  const [capacity, setCapacity] = useState(g.capacity);
  const [templateId, setTemplateId] = useState(g.templateId ?? "");
  const [notes, setNotes] = useState(g.notes);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const start = atTime(date, time);
    if (!title.trim()) return setError("Give the class a title.");
    if (Number.isNaN(start.getTime())) return setError("Choose a date and time.");
    setBusy(true);
    const err = await editClass(g.id, { title: title.trim(), start: start.toISOString(), durationMin: minutes, capacity, templateId, notes: notes.trim() });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit class"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Class title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start time">
            <Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Length (min)">
            <Input type="number" inputMode="numeric" min={15} max={300} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 0)} />
          </Field>
          <Field label="Max spots" hint="2 – 30">
            <Input type="number" inputMode="numeric" min={2} max={30} value={capacity} onChange={(e) => setCapacity(Math.round(Number(e.target.value)) || 0)} />
          </Field>
        </div>
        <Field label="Group workout">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Choose later</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes for attendees">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
        <p className="text-xs text-muted">Moving the class notifies everyone who is booked.</p>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

/* ---------------- Start the group workout ---------------- */
interface PlanRow {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
}

function StartWorkoutModal({ g, open, onClose }: { g: GroupSession; open: boolean; onClose: () => void }) {
  return open ? <StartForm key={g.id} g={g} onClose={onClose} /> : null;
}

function StartForm({ g, onClose }: { g: GroupSession; onClose: () => void }) {
  const { db, user, exMap } = useViewer();
  const templates = db.templates.filter((t) => t.ownerId === user?.id && t.exercises.length > 0);
  const [mode, setMode] = useState<"template" | "build">(templates.length ? "template" : "build");
  const [templateId, setTemplateId] = useState(g.templateId ?? templates[0]?.id ?? "");
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [picker, setPicker] = useState(false);
  const [title, setTitle] = useState(g.title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const going = (g.members ?? []).filter((m) => m.status === "CONFIRMED").length;

  const push = async () => {
    setError(null);
    if (mode === "template" && !templateId) return setError("Choose a routine.");
    if (mode === "build" && plan.length === 0) return setError("Add at least one exercise.");
    setBusy(true);
    const err = await startClassWorkout(g.id, mode === "template" ? { templateId, title: title.trim() } : { plan, title: title.trim() });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Start group workout"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={push} disabled={busy}>
            <Dumbbell size={16} /> {busy ? "Sending…" : `Push to ${going} ${going === 1 ? "person" : "people"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">Everyone booked gets their own copy on their phone, pre-filled with their own previous weights and reps. You’ll follow them all on the live grid.</p>
        <Field label="Workout title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
        <div className="flex gap-2">
          <Button variant={mode === "template" ? "primary" : "secondary"} size="sm" onClick={() => setMode("template")} disabled={templates.length === 0}>
            Saved routine
          </Button>
          <Button variant={mode === "build" ? "primary" : "secondary"} size="sm" onClick={() => setMode("build")}>
            Build on the fly
          </Button>
        </div>
        {mode === "template" ? (
          <Field label="Routine">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.exercises.length} exercises
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="space-y-2">
            {plan.map((row, i) => (
              <div key={row.exerciseId + i} className="grid grid-cols-[1fr_64px_64px_64px_36px] items-center gap-2">
                <div className="truncate text-sm font-semibold">{exMap.get(row.exerciseId)?.name ?? "Exercise"}</div>
                <Input aria-label="Sets" type="number" inputMode="numeric" min={1} max={20} value={row.sets} onChange={(e) => setPlan((p) => p.map((r, j) => (j === i ? { ...r, sets: Math.max(1, Number(e.target.value) || 1) } : r)))} />
                <Input aria-label="Min reps" type="number" inputMode="numeric" min={0} value={row.repMin} onChange={(e) => setPlan((p) => p.map((r, j) => (j === i ? { ...r, repMin: Math.max(0, Number(e.target.value) || 0) } : r)))} />
                <Input aria-label="Max reps" type="number" inputMode="numeric" min={0} value={row.repMax} onChange={(e) => setPlan((p) => p.map((r, j) => (j === i ? { ...r, repMax: Math.max(0, Number(e.target.value) || 0) } : r)))} />
                <button type="button" aria-label="Remove exercise" className="text-muted hover:text-danger" onClick={() => setPlan((p) => p.filter((_, j) => j !== i))}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {plan.length > 0 && <div className="grid grid-cols-[1fr_64px_64px_64px_36px] gap-2 text-[10px] font-bold uppercase tracking-wider text-muted"><span /><span>Sets</span><span>Reps min</span><span>Reps max</span><span /></div>}
            <Button variant="outline" onClick={() => setPicker(true)}>
              <Plus size={16} /> Add exercises
            </Button>
            <ExercisePicker open={picker} onClose={() => setPicker(false)} onConfirm={(ids) => setPlan((p) => [...p, ...ids.map((id) => ({ exerciseId: id, sets: 3, repMin: 8, repMax: 12 }))])} />
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
