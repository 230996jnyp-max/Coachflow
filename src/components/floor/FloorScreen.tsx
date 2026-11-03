"use client";

import { format, parseISO } from "date-fns";
import { ArrowLeft, CheckCircle2, CloudOff, Flag, Play, Trophy, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar, Button, Card, Notice } from "@/components/ui";
import { beep } from "@/components/workout/RestTimer";
import { buildFloorWorkout, defaultTemplateId, laneProgress, laneWorkout, type FloorSession, resolveFloorSession } from "@/lib/floor";
import { useOnline, useWakeLock } from "@/lib/floorHooks";
import { useViewer } from "@/lib/hooks";
import { addWorkouts, refreshTraining, useLivePolling, useNow, useUnsent } from "@/lib/store";
import { cn, fmtClock, uid } from "@/lib/utils";
import { EndSessionModal } from "./EndSessionModal";
import { FloorLane, RestChip, type LaneRest } from "./FloorLane";
import { WalkInModal } from "./WalkInModal";

/** Columns when several people are shown side by side (laptop, or a tablet turned landscape). Four people make a 2 x 2 grid. */
const GRID: Record<number, string> = { 1: "", 2: "lg:grid lg:grid-cols-2", 3: "lg:grid lg:grid-cols-2 xl:grid-cols-3", 4: "lg:grid lg:grid-cols-2" };

function RestWatcher({ rest, onOver, onDismiss }: { rest: LaneRest; onOver: () => void; onDismiss: () => void }) {
  const cb = useRef({ onOver, onDismiss });
  useEffect(() => {
    cb.current = { onOver, onDismiss };
  });
  useEffect(() => {
    if (rest.over) {
      const t = setTimeout(() => cb.current.onDismiss(), 8000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => {
        beep();
        cb.current.onOver();
      },
      Math.max(0, rest.endsAt - Date.now()),
    );
    return () => clearTimeout(t);
  }, [rest.endsAt, rest.over]);
  return null;
}

function SessionClock({ since }: { since: string }) {
  const now = useNow(1000);
  return <span className="tabular-nums">{fmtClock(Math.max(0, (now.getTime() - parseISO(since).getTime()) / 1000))}</span>;
}

function SaveStatus() {
  const online = useOnline();
  const unsent = useUnsent();
  if (!online)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-pr/40 bg-pr/10 px-2.5 py-1 text-[11px] font-bold text-pr">
        <CloudOff size={12} /> Offline · saved on this device{unsent ? ` (${unsent})` : ""}
      </span>
    );
  if (unsent > 0) return <span className="inline-flex items-center gap-1.5 rounded-full bg-field px-2.5 py-1 text-[11px] font-bold text-muted">Saving… {unsent}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-bold text-success">
      <CheckCircle2 size={12} /> All saved
    </span>
  );
}

/** Coach: run a live session for one to four people (or a class) from one screen. */
export function FloorScreen({ sessionKey }: { sessionKey: string }) {
  const { db, user, exMap, unit } = useViewer();
  useLivePolling(true); // clients logging on their own phones show up here within a few seconds
  const session = resolveFloorSession(db, sessionKey);
  const [sel, setSel] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState(false);
  const [rests, setRests] = useState<Record<string, LaneRest>>({});
  const [ending, setEnding] = useState(false);
  const [adding, setAdding] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useWakeLock(!!session && !session.finalized && !session.cancelled);

  if (!user) return null;
  if (!session)
    return (
      <Card className="space-y-3 p-8 text-center">
        <div className="font-semibold">Session not found</div>
        <p className="text-sm text-muted">It may have been cancelled, or it isn’t one of your sessions.</p>
        <Link href="/schedule" className="inline-block text-sm font-semibold text-accent">
          Open the schedule
        </Link>
      </Card>
    );
  if (session.finalized) return <FinishedSummary session={session} />;
  if (session.cancelled || session.pending)
    return (
      <Card className="space-y-3 p-8 text-center">
        <div className="font-semibold">{session.cancelled ? "This session was cancelled" : "This booking is still waiting for approval"}</div>
        <Link href="/schedule" className="inline-block text-sm font-semibold text-accent">
          Back to the schedule
        </Link>
      </Card>
    );

  const people = session.participants;
  const lanes = people.map((p) => ({ p, w: laneWorkout(db.workouts, session, p.clientId) }));
  const started = lanes.filter((l) => l.w);
  const multi = people.length >= 2 && people.length <= 4;
  const selected = people.find((p) => p.clientId === sel)?.clientId ?? people[0]?.clientId;
  const nameOf = (id: string) => db.users.find((u) => u.id === id)?.name ?? "Client";
  const routineFor = (id: string) => choice[id] ?? defaultTemplateId(db, session, id) ?? "";
  const firstStart = started.map((l) => l.w?.liveStartedAt ?? l.w?.startedAt ?? "").filter(Boolean).sort()[0];

  const startFor = async (ids: string[]) => {
    setStarting(true);
    await refreshTraining(); // see anything another device already created, so nobody's logged sets are replaced
    addWorkouts(
      ids.map((cid) => {
        const tid = routineFor(cid);
        return buildFloorWorkout({
          session,
          clientId: cid,
          coachId: user.id,
          template: tid ? db.templates.find((t) => t.id === tid) : undefined,
          workouts: db.workouts,
          exMap,
          unit,
          now: new Date(),
          gymId: session.gymId ?? db.clients.find((c) => c.id === cid)?.defaultGymId ?? null,
          newId: uid,
        });
      }),
    );
    setStarting(false);
  };

  const startRest = (cid: string, sec: number) => setRests((r) => ({ ...r, [cid]: { endsAt: Date.now() + sec * 1000, total: sec } }));
  const adjustRest = (cid: string, d: number) =>
    setRests((r) => {
      const x = r[cid];
      return x ? { ...r, [cid]: { endsAt: Math.max(Date.now() + 1000, x.endsAt + d * 1000), total: Math.max(15, x.total + d) } } : r;
    });
  const dropRest = (cid: string) =>
    setRests((r) => {
      const next = { ...r };
      delete next[cid];
      return next;
    });
  const restOver = (cid: string) => setRests((r) => (r[cid] ? { ...r, [cid]: { ...r[cid], over: true } } : r));

  const go = (dir: 1 | -1) => {
    const i = people.findIndex((p) => p.clientId === selected);
    const next = people[Math.min(people.length - 1, Math.max(0, i + dir))];
    if (next) setSel(next.clientId);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s || people.length < 2) return;
    if (multi && window.matchMedia("(min-width: 1024px)").matches) return; // everyone is already on screen
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/trainer" aria-label="Back to the dashboard" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-field hover:text-ink">
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight">{session.title}</h1>
          <p className="text-xs text-muted">
            {format(parseISO(session.start), "EEE d MMM, h:mm a")} to {format(parseISO(session.end), "h:mm a")}
            {firstStart && (
              <>
                {" "}· running <SessionClock since={firstStart} />
              </>
            )}
          </p>
        </div>
        <SaveStatus />
        <div className="flex w-full gap-2 sm:w-auto">
          {session.canWalkIn && (
            <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setAdding(true)}>
              <UserPlus size={16} /> Add client
            </Button>
          )}
          <Button variant="success" className="flex-1 sm:flex-none" onClick={() => setEnding(true)}>
            <Flag size={16} /> End session
          </Button>
        </div>
      </div>

      {people.length === 0 && <Notice>Nobody is booked into this session yet. Use “Add client” to bring someone in.</Notice>}

      {started.length === 0 && people.length > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-accent/40 bg-accent-dim p-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">Ready to go</div>
            <p className="text-xs text-muted">Starts a workout for {people.length === 1 ? nameOf(people[0].clientId) : `all ${people.length} people`}, pre-filled from what they did last time. You can change a routine before you start.</p>
          </div>
          <Button size="lg" onClick={() => startFor(people.map((p) => p.clientId))} disabled={starting}>
            <Play size={18} /> {starting ? "Starting…" : "Start session"}
          </Button>
        </Card>
      )}

      {people.length > 1 && (
        <div className={cn("-mx-1 flex gap-2 overflow-x-auto px-1 pb-1", multi && "lg:hidden")} role="tablist" aria-label="People in this session">
          {people.map((p) => {
            const w = laneWorkout(db.workouts, session, p.clientId);
            const prog = laneProgress(w);
            const r = rests[p.clientId];
            const on = p.clientId === selected;
            return (
              <button
                key={p.clientId}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setSel(p.clientId)}
                className={cn("flex min-h-14 shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-colors", on ? "border-accent bg-accent/10" : "border-line bg-surface", r?.over && "border-success")}
              >
                <Avatar name={nameOf(p.clientId)} size={30} />
                <span>
                  <span className="block max-w-28 truncate text-sm font-bold">{nameOf(p.clientId).split(" ")[0]}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted">
                    {w ? `${prog.done}/${prog.total}` : "not started"}
                    {prog.prs > 0 && (
                      <span className="inline-flex items-center gap-0.5 font-bold text-pr">
                        <Trophy size={10} />
                        {prog.prs}
                      </span>
                    )}
                    {r && <RestChip rest={r} compact />}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className={cn("gap-4", multi && GRID[people.length])} onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })} onTouchEnd={onTouchEnd}>
        {lanes.map(({ p, w }) => (
          <div key={p.clientId} className={cn(p.clientId === selected ? "block" : "hidden", multi && "lg:block")}>
            <FloorLane
              session={session}
              clientId={p.clientId}
              workout={w}
              routineId={routineFor(p.clientId)}
              onChooseRoutine={(id) => setChoice((c) => ({ ...c, [p.clientId]: id }))}
              onStart={() => startFor([p.clientId])}
              starting={starting}
              rest={rests[p.clientId]}
              restSeconds={db.settings.restSeconds}
              onRest={(sec) => startRest(p.clientId, sec)}
              onAdjustRest={(d) => adjustRest(p.clientId, d)}
              onSkipRest={() => dropRest(p.clientId)}
            />
          </div>
        ))}
      </div>

      {Object.entries(rests).map(([cid, r]) => (
        <RestWatcher key={cid} rest={r} onOver={() => restOver(cid)} onDismiss={() => dropRest(cid)} />
      ))}

      {adding && <WalkInModal session={session} onClose={() => setAdding(false)} />}
      {ending && <EndSessionModal session={session} onClose={() => setEnding(false)} />}
    </div>
  );
}

/** A finished session: who trained, how much, and any records. */
function FinishedSummary({ session }: { session: FloorSession }) {
  const { db } = useViewer();
  const unsent = useUnsent();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/trainer" aria-label="Back to the dashboard" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-field hover:text-ink">
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight">{session.title}</h1>
          <p className="text-xs text-muted">{format(parseISO(session.start), "EEE d MMM, h:mm a")} · finished</p>
        </div>
        <SaveStatus />
      </div>
      <Notice tone="success">Session complete. Attendance and credits are settled{unsent ? ", and the last changes are still being saved" : ""}.</Notice>
      <div className="grid gap-3 sm:grid-cols-2">
        {session.participants.map((p) => {
          const w = laneWorkout(db.workouts, session, p.clientId);
          const prog = laneProgress(w);
          const name = db.users.find((u) => u.id === p.clientId)?.name ?? "Client";
          return (
            <Card key={p.clientId} className="flex items-center gap-3 p-3">
              <Avatar name={name} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{name}</div>
                <div className="text-xs text-muted">{w ? `${prog.done} set${prog.done === 1 ? "" : "s"}${prog.prs ? ` · ${prog.prs} PR${prog.prs > 1 ? "s" : ""}` : ""}` : "No workout saved"}</div>
              </div>
              {w && (
                <Link href={`/workout/${w.id}`} className="text-xs font-semibold text-accent">
                  Open →
                </Link>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
