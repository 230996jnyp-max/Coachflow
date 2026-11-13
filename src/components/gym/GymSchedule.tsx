"use client";

import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Dumbbell, Plus, Repeat, UserRoundCog, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { api, useNow } from "@/lib/store";
import { cn } from "@/lib/utils";
import { can, type ScheduleData, type ScheduleItem } from "./types";
import type { GymInfo } from "@/lib/gymPerms";

type Action = { kind: "cover" | "cancel" | "move"; item: ScheduleItem } | { kind: "class" } | null;

/** Every coach's sessions and classes side by side for a week, with the gym's tools to cover, cancel, move a client or add a class. */
export function GymSchedule({ gym }: { gym: GymInfo }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [coachId, setCoachId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [act, setAct] = useState<Action>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const manage = can(gym, "schedule.manage");

  const load = useCallback(async () => {
    const q = new URLSearchParams({ from: weekStart.toISOString(), to: addDays(weekStart, 7).toISOString() });
    if (coachId) q.set("coachId", coachId);
    if (branchId) q.set("branchId", branchId);
    const r = await api<ScheduleData>(`/api/gym/schedule?${q}`);
    if (r.ok && r.data) {
      setData(r.data);
      setError(null);
    } else setError(r.error ?? "Could not load the schedule.");
  }, [weekStart, coachId, branchId]);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ from: weekStart.toISOString(), to: addDays(weekStart, 7).toISOString() });
    if (coachId) q.set("coachId", coachId);
    if (branchId) q.set("branchId", branchId);
    api<ScheduleData>(`/api/gym/schedule?${q}`).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) {
        setData(r.data);
        setError(null);
      } else setError(r.error ?? "Could not load the schedule.");
    });
    return () => {
      alive = false;
    };
  }, [weekStart, coachId, branchId]);

  const days = useMemo(() => {
    const out: { day: Date; items: ScheduleItem[] }[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const key = format(day, "yyyy-MM-dd");
      out.push({ day, items: (data?.items ?? []).filter((x) => format(parseISO(x.start), "yyyy-MM-dd") === key) });
    }
    return out;
  }, [data, weekStart]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="Previous week" onClick={() => setWeekStart((w) => addDays(w, -7))}>
            <ChevronLeft size={16} />
          </Button>
          <div className="min-w-44 text-center text-sm font-semibold">
            {format(weekStart, "d MMM")} – {format(addDays(weekStart, 6), "d MMM yyyy")}
          </div>
          <Button variant="secondary" size="sm" aria-label="Next week" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            <ChevronRight size={16} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            This week
          </Button>
        </div>
        <div className="flex-1" />
        {manage && (
          <Button size="sm" onClick={() => setAct({ kind: "class" })}>
            <Plus size={16} /> New class
          </Button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={coachId} onChange={(e) => setCoachId(e.target.value)} aria-label="Filter by coach">
          <option value="">All coaches</option>
          {(data?.coaches ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Filter by branch or hall">
          <option value="">All branches and halls</option>
          {(data?.branches ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {flash && <Notice tone="success">{flash}</Notice>}
      {!data && !error && <Card className="p-6 text-center text-sm text-muted">Loading…</Card>}

      {data &&
        days.map(({ day, items }) => (
          <section key={day.toISOString()}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{format(day, "EEEE d MMM")}</h3>
            {items.length === 0 ? (
              <p className="px-1 pb-1 text-sm text-muted">Nothing scheduled.</p>
            ) : (
              <div className="space-y-2">
                {items.map((it) => (
                  <ItemCard key={it.id} it={it} open={open === it.id} onToggle={() => setOpen(open === it.id ? null : it.id)} manage={manage} onAct={(kind) => setAct({ kind, item: it })} />
                ))}
              </div>
            )}
          </section>
        ))}

      {act && (
        <ActionModal
          act={act}
          coaches={data?.coaches ?? []}
          branches={data?.branches ?? []}
          onClose={() => setAct(null)}
          onDone={(text) => {
            setAct(null);
            setFlash(text);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ItemCard({ it, open, onToggle, manage, onAct }: { it: ScheduleItem; open: boolean; onToggle: () => void; manage: boolean; onAct: (k: "cover" | "cancel" | "move") => void }) {
  const now = useNow(60_000);
  const upcoming = parseISO(it.end).getTime() > now.getTime() && (it.status === "CONFIRMED" || it.status === "PENDING" || it.status === "OPEN");
  return (
    <Card className={cn("p-0", it.clash && "border-pr/50")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 p-3 text-left">
        <div className="w-16 shrink-0 text-center">
          <div className="text-sm font-bold">{format(parseISO(it.start), "h:mm a")}</div>
          <div className="text-[10px] text-muted">{format(parseISO(it.end), "h:mm a")}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold">{it.title}</span>
            <Badge>{it.kind === "class" ? "Class" : "1-on-1"}</Badge>
            {it.originalCoachName && (
              <Badge className="border-accent/30 bg-accent/15 text-accent">
                <Repeat size={11} className="mr-1" /> Covering {it.originalCoachName}
              </Badge>
            )}
            {it.clash && (
              <Badge className="border-pr/30 bg-pr/15 text-pr">
                <AlertTriangle size={11} className="mr-1" /> Same place, same time
              </Badge>
            )}
            {it.status === "COMPLETED" && <Badge className="border-success/30 bg-success/15 text-success">Done</Badge>}
            {it.status === "NO_SHOW" && <Badge className="border-danger/30 bg-danger/15 text-danger">No-show</Badge>}
          </div>
          <div className="truncate text-sm text-muted">
            {it.coachName} · {it.location}
          </div>
          <div className="truncate text-xs text-muted">
            {it.kind === "class" ? `${it.spotsTaken ?? 0}/${it.capacity} booked${it.clients.length ? `: ${it.clients.join(", ")}` : ""}` : it.clients.join(", ")}
          </div>
        </div>
        <ChevronDown size={18} className={cn("mt-1 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3 pb-3 pt-3">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
              <Dumbbell size={13} /> Workout
            </div>
            {it.workout ? (
              <div className="rounded-xl bg-field p-3 text-sm">
                <div className="font-semibold">
                  {it.workout.title} <span className="font-normal text-muted">({it.workout.source})</span>
                </div>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {it.workout.exercises.map((e, i) => (
                    <li key={i}>
                      {e.name} · {e.sets} set{e.sets === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted">No workout planned or logged yet.</p>
            )}
          </div>
          {manage && upcoming && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onAct("cover")}>
                <Repeat size={14} /> {it.originalCoachName ? "Change cover" : "Arrange cover"}
              </Button>
              <Button size="sm" variant="danger" onClick={() => onAct("cancel")}>
                <XCircle size={14} /> Cancel and notify
              </Button>
              {it.kind === "session" && it.clientId && (
                <Button size="sm" variant="secondary" onClick={() => onAct("move")}>
                  <UserRoundCog size={14} /> Move client to another coach
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ActionModal({ act, coaches, branches, onClose, onDone }: { act: NonNullable<Action>; coaches: { id: string; name: string }[]; branches: { id: string; name: string }[]; onClose: () => void; onDone: (text: string) => void }) {
  const item = act.kind === "class" ? null : act.item;
  const others = coaches.filter((c) => !item || c.name !== item.coachName);
  const [coach, setCoach] = useState(act.kind === "class" ? (coaches[0]?.id ?? "") : (others[0]?.id ?? ""));
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [spots, setSpots] = useState("10");
  const [length, setLength] = useState("60");
  const [weeks, setWeeks] = useState("1");
  const [where, setWhere] = useState(branches[0]?.name ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    let r;
    let done = "";
    if (act.kind === "cover") {
      r = await api("/api/gym/cover", { body: { action: "cover", kind: item!.kind, id: item!.id, toCoachId: coach } });
      done = "Cover arranged. Everyone involved was told.";
    } else if (act.kind === "cancel") {
      r = await api("/api/gym/cover", { body: { action: "cancel", kind: item!.kind, id: item!.id, reason } });
      done = "Cancelled. Everyone involved was told.";
    } else if (act.kind === "move") {
      r = await api("/api/gym/moves", { body: { clientId: item!.clientId, toCoachId: coach } });
      done = "Request sent. The client has to agree before anything changes.";
    } else {
      r = await api<{ created: number; skipped: string[] }>("/api/gym/classes", { body: { coachId: coach, title, start: start ? new Date(start).toISOString() : "", capacity: Number(spots), durationMin: Number(length), repeatWeeks: Number(weeks), location: where, notes } });
      const d = r.data as { created?: number; skipped?: string[] } | null;
      done = `Class created${d?.created && d.created > 1 ? ` (${d.created} weeks)` : ""}.${d?.skipped?.length ? ` Skipped: ${d.skipped.join("; ")}` : ""}`;
    }
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "That didn't work.");
    onDone(done);
  };

  const heading = act.kind === "cover" ? "Arrange cover" : act.kind === "cancel" ? "Cancel and notify" : act.kind === "move" ? "Move client to another coach" : "New class";
  return (
    <Modal
      open
      onClose={onClose}
      title={heading}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant={act.kind === "cancel" ? "danger" : "primary"} disabled={busy || (act.kind === "class" ? !coach || title.trim().length < 2 || !start || !where.trim() : act.kind !== "cancel" && !coach)} onClick={() => void run()}>
            {busy ? "Working…" : act.kind === "cancel" ? "Cancel it" : act.kind === "class" ? "Create class" : act.kind === "move" ? "Send request" : "Arrange cover"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {item && (
          <p className="text-sm text-muted">
            {item.title} · {format(parseISO(item.start), "EEE d MMM, h:mm a")} · {item.coachName}
          </p>
        )}
        {act.kind === "cover" && (
          <>
            <Field label="Who covers it?" hint="The session moves to their schedule. Choose the original coach to undo cover. The coach, the cover coach and the client(s) are told.">
              <Select value={coach} onChange={(e) => setCoach(e.target.value)}>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        {act.kind === "move" && (
          <Field label="New coach" hint="The client is asked first. If they agree, their upcoming sessions go with them where the new coach is free.">
            <Select value={coach} onChange={(e) => setCoach(e.target.value)}>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {act.kind === "cancel" && (
          <Field label="Reason (optional)" hint="Included in the message to the coach and the client(s).">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={200} />
          </Field>
        )}
        {act.kind === "class" && (
          <>
            <Field label="Coach">
              <Select value={coach} onChange={(e) => setCoach(e.target.value)}>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Class title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning HIIT" maxLength={100} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">
                <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field label="Where">
                <Input value={where} onChange={(e) => setWhere(e.target.value)} list="gym-branches" placeholder="Hall or branch" />
                <datalist id="gym-branches">
                  {branches.map((b) => (
                    <option key={b.id} value={b.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Spots">
                <Input type="number" min={2} max={30} value={spots} onChange={(e) => setSpots(e.target.value)} />
              </Field>
              <Field label="Length (min)">
                <Input type="number" min={15} max={300} step={15} value={length} onChange={(e) => setLength(e.target.value)} />
              </Field>
              <Field label="Repeat for (weeks)" hint="1 = just once">
                <Input type="number" min={1} max={26} value={weeks} onChange={(e) => setWeeks(e.target.value)} />
              </Field>
            </div>
            <Field label="Notes (optional)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
            </Field>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
