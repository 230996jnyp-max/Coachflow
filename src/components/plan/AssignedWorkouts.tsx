"use client";

import { addDays, format, parseISO } from "date-fns";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Dumbbell, MessageSquareText, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Card, SectionTitle } from "@/components/ui";
import { activeOf, assignmentState, dayKey, isAssignmentDone, resultOf, sortAssignments } from "@/lib/assignments";
import { useViewer } from "@/lib/hooks";
import { startAssigned, useNow } from "@/lib/store";
import type { Assignment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ExerciseRows } from "./PhonePreview";

/**
 * What the coach assigned: today's workout(s) with a Start button, anything missed in the last week (still doable now), and what is coming
 * up. Shows nothing at all for someone without assigned workouts. A client can still start any routine or an empty workout from the
 * Workout page; this only puts the coach's plan first.
 */
export function AssignedWorkouts() {
  const { db, user, coach } = useViewer();
  const now = useNow(60_000);
  const todayKey = dayKey(now);

  const view = useMemo(() => {
    const mine = sortAssignments(db.assignments.filter((a) => a.clientId === user?.id));
    const done = (a: Assignment) => isAssignmentDone(a, db.workouts);
    const weekAgo = dayKey(addDays(now, -7));
    const ahead = dayKey(addDays(now, 7));
    return {
      today: mine.filter((a) => a.date === todayKey),
      missed: mine.filter((a) => a.date < todayKey && a.date >= weekAgo && !done(a)),
      soon: mine.filter((a) => a.date > todayKey && a.date <= ahead).slice(0, 5),
    };
  }, [db.assignments, db.workouts, user?.id, now, todayKey]);

  if (!user || user.personal) return null;
  if (!view.today.length && !view.missed.length && !view.soon.length) return null;
  const coachName = coach?.name ?? "your coach";

  return (
    <section data-tour="assigned-workouts" className="space-y-3">
      {view.today.length > 0 && (
        <div>
          <SectionTitle>Today&apos;s workout</SectionTitle>
          <div className="space-y-2">
            {view.today.map((a) => (
              <Item key={a.id} a={a} todayKey={todayKey} coachName={coachName} />
            ))}
          </div>
        </div>
      )}
      {view.missed.length > 0 && (
        <div>
          <SectionTitle>Missed</SectionTitle>
          <div className="space-y-2">
            {view.missed.map((a) => (
              <Item key={a.id} a={a} todayKey={todayKey} coachName={coachName} />
            ))}
          </div>
        </div>
      )}
      {view.soon.length > 0 && (
        <div>
          <SectionTitle>Coming up</SectionTitle>
          <div className="space-y-2">
            {view.soon.map((a) => (
              <Item key={a.id} a={a} todayKey={todayKey} coachName={coachName} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Item({ a, todayKey, coachName }: { a: Assignment; todayKey: string; coachName: string }) {
  const { db } = useViewer();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const done = isAssignmentDone(a, db.workouts);
  const state = assignmentState(a, done, todayKey);
  const result = resultOf(a, db.workouts);
  const resume = activeOf(a, db.workouts);

  const start = () => {
    const id = startAssigned(a.id);
    if (id) router.push(`/workout/${id}`);
  };

  return (
    <Card className={cn("space-y-3 p-4", state === "today" && "border-accent/50 bg-accent-dim/30", state === "missed" && "border-danger/40 bg-danger/5", state === "done" && "border-success/30")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
            {state === "missed" ? (
              <span className="flex items-center gap-1 text-danger">
                <AlertTriangle size={12} /> Missed {format(parseISO(a.date), "EEE d MMM")}
              </span>
            ) : state === "upcoming" ? (
              <span className="text-muted">{format(parseISO(a.date), "EEEE d MMM")}</span>
            ) : state === "done" ? (
              <span className="flex items-center gap-1 text-success">
                <Check size={12} /> Done
              </span>
            ) : (
              <span className="text-accent">From {coachName.split(" ")[0] === "Coach" ? coachName : `Coach ${coachName.split(" ")[0]}`}</span>
            )}
          </div>
          <div className="mt-0.5 text-lg font-bold leading-snug">{a.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <Dumbbell size={12} /> {a.exercises.length} {a.exercises.length === 1 ? "exercise" : "exercises"}
          </div>
        </div>
        {state === "done" && result ? (
          <Link href={`/workout/${result.id}`}>
            <Button size="sm" variant="secondary">
              View result
            </Button>
          </Link>
        ) : state === "today" || state === "missed" ? (
          <Button onClick={start}>
            <Play size={16} /> {resume ? "Resume" : state === "missed" ? "Do it now" : "Start"}
          </Button>
        ) : null}
      </div>

      {a.note && (
        <div className="flex gap-2 rounded-xl border border-accent/30 bg-accent/10 p-3 text-sm">
          <MessageSquareText size={15} className="mt-0.5 shrink-0 text-accent" />
          <span className="[overflow-wrap:anywhere]">{a.note}</span>
        </div>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-9 items-center gap-1.5 text-xs font-semibold text-accent">
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? "Hide exercises" : "See exercises"}
      </button>
      {open && <ExerciseRows exercises={a.exercises} />}
      {a.doneManually && !result && <Badge className="border-success/30 bg-success/15 text-success">Marked done by your coach</Badge>}
    </Card>
  );
}
