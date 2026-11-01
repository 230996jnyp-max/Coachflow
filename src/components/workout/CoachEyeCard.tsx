"use client";

import { format, parseISO } from "date-fns";
import { AlertTriangle, ChevronDown, Eye, Flame, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge, Card } from "@/components/ui";
import { useAiNote } from "@/lib/aiNote";
import { buildEye, eyeFacts } from "@/lib/coachEye";
import { useViewer } from "@/lib/hooks";
import { sportLabel } from "@/lib/sports";
import { useNow } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * "Coach's Eye": everything a coach needs in 60 seconds before (and during) a session, on one collapsible card: focus and injury
 * notes, the last session, records within reach today, credits and attendance. Coach only.
 */
export function CoachEyeCard({ clientId, planned = [], defaultOpen = false, className }: { clientId: string; planned?: string[]; defaultOpen?: boolean; className?: string }) {
  const { db, unit, exMap, isTrainer } = useViewer();
  const now = useNow(60_000);
  const [open, setOpen] = useState(defaultOpen);
  const profile = db.clients.find((c) => c.id === clientId);
  const eye = profile && isTrainer ? buildEye({ profile, bookings: db.bookings, workouts: db.workouts, exMap, unit, planned, now }) : null;
  const note = useAiNote("eye", eye ? eyeFacts(eye, now) : "", open && !!eye);
  if (!eye) return null;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex min-w-0 items-center gap-2 font-bold">
          <Eye size={18} className="shrink-0 text-accent" /> Coach&apos;s Eye
          <span className="hidden truncate text-xs font-medium text-muted sm:inline">Pre-session brief</span>
          {eye.injury && <AlertTriangle size={15} className="shrink-0 text-danger" aria-label="Injury or medical note" />}
          {eye.lowCredits && <Badge className="border-pr/30 bg-pr/15 text-pr">Low credits</Badge>}
        </span>
        <ChevronDown size={18} className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-4 py-4 text-sm">
          {note && (
            <p className="flex items-start gap-1.5 rounded-lg bg-accent/10 px-3 py-2 text-xs text-ink">
              <Sparkles size={13} className="mt-0.5 shrink-0 text-accent" /> {note}
            </p>
          )}

          <section className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Focus &amp; alerts</div>
            <div className="flex flex-wrap gap-1.5">
              {eye.focuses.length ? eye.focuses.map((f) => <Badge key={f} className="border-accent/30 bg-accent/10 text-accent">{sportLabel(f)}</Badge>) : <span className="text-xs text-muted">No training focus set (everything is available).</span>}
            </div>
            {eye.injury && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide">Injury / medical notes</div>
                  <div className="text-sm font-semibold">{eye.injury}</div>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Last session</div>
            {eye.last ? (
              <>
                <div className="font-semibold">
                  {eye.last.title} <span className="font-normal text-muted">· {format(parseISO(eye.last.date), "EEE d MMM")}</span>
                </div>
                <ul className="space-y-0.5 text-muted">
                  {eye.last.tops.map((t) => (
                    <li key={t.exercise} className="flex justify-between gap-3">
                      <span className="truncate">{t.exercise}</span>
                      <span className="shrink-0 font-semibold text-ink">{t.text}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-xs text-muted">No finished workouts yet.</p>
            )}
          </section>

          <section className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-pr">
              <Flame size={13} /> PRs within reach today
            </div>
            {eye.reach.length ? (
              <ul className="space-y-1.5">
                {eye.reach.map((r) => (
                  <li key={r.exerciseId} className="rounded-lg bg-pr/10 px-3 py-2">
                    <span className="font-semibold">{r.exercise}:</span> {r.target} <span className="text-pr">will beat their {r.beats}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Nothing close right now. Today is a good day to build volume.</p>
            )}
          </section>

          <section className="grid grid-cols-3 gap-2 text-center">
            <Pulse label="1-on-1 credits" value={String(eye.credits)} warn={eye.lowCredits} />
            <Pulse label="Group credits" value={String(eye.groupCredits)} warn={eye.groupCredits <= 2} />
            <Pulse label="Attendance" value={eye.attendance === null ? "—" : `${eye.attendance}%`} sub={eye.marked ? `${eye.attended}/${eye.marked} in 90 days` : "none marked"} />
          </section>
        </div>
      )}
    </Card>
  );
}

function Pulse({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-xl py-2", warn ? "bg-pr/15" : "bg-field")}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className={cn("text-lg font-bold", warn && "text-pr")}>{value}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
      {warn && !sub && <div className="text-[10px] font-semibold text-pr">Low</div>}
    </div>
  );
}
