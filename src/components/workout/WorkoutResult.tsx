"use client";

import { format, parseISO } from "date-fns";
import { Pencil, Share2, Trophy } from "lucide-react";
import { useState } from "react";
import { Avatar, Badge, Button, Card, Notice } from "@/components/ui";
import { hasFeedback, painLevel } from "@/lib/feedback";
import { volumeComparison } from "@/lib/fun";
import { useViewer } from "@/lib/hooks";
import { isWeightType, PR_LABELS, formatSet, setE1RM, workoutSetCount, workoutVolume } from "@/lib/stats";
import type { WorkoutSet } from "@/lib/types";
import { cn, fmtDurationShort, fmtVolume, fmtWeight } from "@/lib/utils";
import { RecapModal } from "./RecapModal";
import { WorkoutTalk } from "./WorkoutTalk";

const PAIN_TONE = { none: "text-success", mild: "text-success", moderate: "text-pr", high: "text-danger" } as const;

/**
 * What a finished workout looked like: time, volume (with a fun comparison), records, how it felt, and every set with its estimated
 * one-rep max. Sets that were planned but not done show in red. Comments and reactions sit underneath. "Edit" opens the full logger.
 */
export function WorkoutResult({ workoutId, onEdit }: { workoutId: string; onEdit: () => void }) {
  const { db, user, unit, exMap, isTrainer } = useViewer();
  const [recap, setRecap] = useState(false);
  const w = db.workouts.find((x) => x.id === workoutId);
  if (!w || !user) return null;

  const client = db.users.find((u) => u.id === w.clientId);
  const volume = workoutVolume(w, exMap);
  const sets = workoutSetCount(w);
  const pbs = w.exercises.reduce((n, we) => n + we.sets.filter((s) => s.done && s.pr?.length).length, 0);
  const missed = w.exercises.reduce((n, we) => n + we.sets.filter((s) => !s.done).length, 0);
  const fun = volume > 0 ? volumeComparison(volume) : null;
  const fb = w.feedback;

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{w.title || "Workout"}</h1>
            <div className="mt-0.5 text-sm text-muted">{format(parseISO(w.startedAt), "EEEE d MMMM yyyy, h:mm a")}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setRecap(true)}>
              <Share2 size={16} /> Recap
            </Button>
            <Button variant="secondary" onClick={onEdit}>
              <Pencil size={16} /> Edit
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {client && isTrainer && (
            <span className="inline-flex items-center gap-2 rounded-full bg-field py-1 pl-1 pr-3">
              <Avatar name={client.name} size={22} />
              <span className="font-semibold">{client.name}</span>
            </span>
          )}
          <Badge className="border-success/30 bg-success/15 text-success">Completed</Badge>
          <Badge className={w.loggedBy === "TRAINER" ? "border-accent/30 bg-accent/15 text-accent" : undefined}>Logged by {w.loggedBy === "TRAINER" ? "coach" : "client"}</Badge>
          {w.groupId && <Badge className="border-accent/30 bg-accent/15 text-accent">Group class</Badge>}
          {w.imported && <Badge>Imported</Badge>}
        </div>

        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4" data-tour="result-stats">
          <Tile label="Duration" value={w.durationSec ? fmtDurationShort(w.durationSec) : "—"} />
          <Tile label="Volume" value={fmtVolume(volume, unit)} />
          <Tile label="Sets done" value={String(sets)} sub={missed ? `${missed} not done` : undefined} subTone="danger" />
          <Tile label="Records" value={String(pbs)} tone={pbs ? "pr" : undefined} sub={pbs ? "new PBs" : undefined} />
        </div>

        {fun && (
          <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            <span className="text-2xl" aria-hidden>
              {fun.emoji}
            </span>
            <span>
              <b>{fmtVolume(volume, unit)} lifted.</b> {fun.text}
            </span>
          </div>
        )}
      </Card>

      {hasFeedback(fb) && (
        <Card className="space-y-2 p-4" data-tour="result-feeling">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">How it felt</h3>
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            {fb?.pain !== undefined && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Pain</div>
                <div className={cn("text-2xl font-bold tabular-nums", PAIN_TONE[painLevel(fb.pain)])}>
                  {fb.pain}
                  <span className="text-sm font-semibold text-muted"> / 10</span>
                </div>
              </div>
            )}
            {fb?.energy !== undefined && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Energy</div>
                <div className="text-2xl font-bold tabular-nums text-accent">
                  {fb.energy}
                  <span className="text-sm font-semibold text-muted"> / 10</span>
                </div>
              </div>
            )}
            {!!fb?.areas?.length && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Where it hurt</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {fb.areas.map((a) => (
                    <Badge key={a}>{a}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {(w.notes || (isTrainer && w.coachNote)) && (
        <div className="space-y-2">
          {w.notes && (
            <Notice tone="info">
              <b>Session notes:</b> {w.notes}
            </Notice>
          )}
          {isTrainer && w.coachNote && (
            <Notice tone="warn">
              <b>Your private note:</b> {w.coachNote}
            </Notice>
          )}
        </div>
      )}

      <div className="space-y-3" data-tour="result-sets">
        {w.exercises.length === 0 && <p className="text-sm text-muted">No exercises in this workout.</p>}
        {w.exercises.map((we) => {
          const ex = exMap.get(we.exerciseId);
          const done = we.sets.filter((s) => s.done).length;
          let n = 0;
          return (
            <Card key={we.id} className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{ex?.name ?? "Exercise"}</div>
                  {we.notes && <div className="truncate text-xs text-muted">{we.notes}</div>}
                </div>
                <span className={cn("shrink-0 text-xs font-semibold", done === we.sets.length ? "text-success" : "text-muted")}>
                  {done} of {we.sets.length} sets
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-muted">
                    <th className="px-4 py-2 font-bold">Set</th>
                    <th className="px-2 py-2 font-bold">Result</th>
                    <th className="px-2 py-2 text-right font-bold">Est. 1RM</th>
                    <th className="px-4 py-2 text-right font-bold" />
                  </tr>
                </thead>
                <tbody>
                  {we.sets.map((s) => {
                    const warm = s.type === "W";
                    if (!warm) n += 1;
                    return <SetLine key={s.id} set={s} label={warm ? "W" : String(n) + (s.type === "D" ? " · drop" : s.type === "F" ? " · failure" : "")} text={formatSet(s, ex, unit)} e1rm={isWeightType(ex) && s.done && !warm ? setE1RM(s) : 0} unit={unit} />;
                  })}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>

      <WorkoutTalk workoutId={w.id} />

      <RecapModal workoutId={w.id} open={recap} onClose={() => setRecap(false)} />
    </div>
  );
}

function Tile({ label, value, sub, tone, subTone }: { label: string; value: string; sub?: string; tone?: "pr"; subTone?: "danger" }) {
  return (
    <div className="rounded-xl bg-field py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className={cn("text-lg font-bold tabular-nums", tone === "pr" && "text-pr")}>{value}</div>
      {sub && <div className={cn("text-[10px] font-semibold", subTone === "danger" ? "text-danger" : "text-muted")}>{sub}</div>}
    </div>
  );
}

function SetLine({ set, label, text, e1rm, unit }: { set: WorkoutSet; label: string; text: string; e1rm: number; unit: "metric" | "imperial" }) {
  const notDone = !set.done;
  return (
    <tr className={cn("border-t border-line/60", notDone && "bg-danger/5")}>
      <td className={cn("px-4 py-2 font-semibold tabular-nums", set.type === "W" ? "text-muted" : notDone ? "text-danger" : "")}>{label}</td>
      <td className={cn("px-2 py-2 tabular-nums", notDone && "text-danger line-through decoration-danger/50")}>{text}</td>
      <td className="px-2 py-2 text-right tabular-nums text-muted">{e1rm > 0 ? fmtWeight(e1rm, unit, 0) : "—"}</td>
      <td className="px-4 py-2 text-right">
        {notDone ? (
          <span className="text-xs font-bold text-danger">Not done</span>
        ) : set.pr?.length ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-pr" title={set.pr.map((p) => PR_LABELS[p]).join(" · ")}>
            <Trophy size={12} /> {set.pr.length > 1 ? "PBs" : "PB"}
          </span>
        ) : null}
      </td>
    </tr>
  );
}
