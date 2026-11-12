"use client";

import { differenceInCalendarDays, format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { CalendarClock, ChevronRight, Phone, Ticket } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { CoachNotes } from "@/components/clients/CoachNotes";
import { FeedIcon } from "@/components/clients/FeedIcon";
import { PctBar, PctPill, ReasonBadges, useStatuses } from "@/components/clients/status";
import { Avatar, Notice } from "@/components/ui";
import { buildFeed } from "@/lib/clientFeed";
import { useViewer } from "@/lib/hooks";
import { useNow } from "@/lib/store";

/**
 * What a coach wants to see while chatting with a client: how training is going, credits and the next session, injuries, private notes
 * and the latest activity, without leaving the conversation. Shown beside the chat on wide screens and as a sheet on phones.
 */
export function ClientSidePanel({ clientId }: { clientId: string }) {
  const { db, clients } = useViewer();
  const now = useNow(60_000);
  const statuses = useStatuses();
  const profile = db.clients.find((c) => c.id === clientId);
  const person = clients.find((c) => c.user.id === clientId)?.user;
  const st = statuses.get(clientId);

  const next = useMemo(
    () =>
      db.bookings
        .filter((b) => b.clientId === clientId && (b.status === "CONFIRMED" || b.status === "PENDING") && parseISO(b.start).getTime() >= now.getTime())
        .sort((a, b) => a.start.localeCompare(b.start))[0],
    [db.bookings, clientId, now],
  );
  const feed = useMemo(
    () => buildFeed({ workouts: db.workouts, metrics: db.metrics, photos: db.photos, bookings: db.bookings, groups: db.groups }, clientId, now, 5),
    [db.workouts, db.metrics, db.photos, db.bookings, db.groups, clientId, now],
  );

  if (!profile || !person) return <p className="p-4 text-sm text-muted">No details for this client.</p>;

  const event = profile.goalEventName && profile.goalEventDate ? { name: profile.goalEventName, days: differenceInCalendarDays(parseISO(profile.goalEventDate), now) } : null;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={person.name} size={48} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{person.name}</div>
          {profile.phone ? (
            <a href={`tel:${profile.phone}`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
              <Phone size={11} /> {profile.phone}
            </a>
          ) : (
            <span className="text-xs text-muted">No phone number</span>
          )}
        </div>
      </div>

      {(profile.personalGoal || profile.goal || event) && (
        <div className="space-y-1 rounded-xl border border-line bg-field/40 p-3 text-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Goal</div>
          <div className="[overflow-wrap:anywhere]">{profile.personalGoal || profile.goal}</div>
          {event && (
            <div className="text-xs text-muted">
              {event.name}: {event.days > 0 ? `${event.days} ${event.days === 1 ? "day" : "days"} to go` : event.days === 0 ? "today" : "done"}
            </div>
          )}
        </div>
      )}

      {profile.medicalNotes && (
        <Notice tone="warn">
          <b>Injuries &amp; limitations:</b> <span className="[overflow-wrap:anywhere]">{profile.medicalNotes}</span>
        </Notice>
      )}

      {st && (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Training</div>
          <div className="flex flex-wrap items-center gap-2">
            <PctPill pct={st.pct7} label="7d" />
            <PctPill pct={st.pct30} label="30d" />
            <span className="text-xs text-muted">
              This week <b className="text-ink">{st.weekDone}</b> of {st.target}
            </span>
          </div>
          <PctBar pct={Math.min(100, Math.round((st.weekDone / Math.max(1, st.target)) * 100))} />
          {st.reasons.length > 0 && <ReasonBadges status={st} max={3} />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl border border-line p-3">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted">
            <Ticket size={11} /> Credits
          </div>
          <div className="mt-0.5 text-xl font-bold tabular-nums">{profile.credits}</div>
          <div className="text-[11px] text-muted">of {profile.packageSize}</div>
        </div>
        <div className="rounded-xl border border-line p-3">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted">
            <CalendarClock size={11} /> Next session
          </div>
          {next ? (
            <>
              <div className="mt-0.5 text-sm font-bold">{format(parseISO(next.start), "EEE d MMM")}</div>
              <div className="text-[11px] text-muted">{format(parseISO(next.start), "h:mm a")}</div>
            </>
          ) : (
            <div className="mt-1 text-xs text-muted">None booked</div>
          )}
        </div>
      </div>

      <CoachNotes clientId={clientId} />

      <div className="space-y-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Recent activity</div>
        {feed.length === 0 ? (
          <p className="text-xs text-muted">Nothing yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {feed.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-xs">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-field text-muted">
                  <FeedIcon kind={e.kind} size={12} />
                </span>
                {e.href ? (
                  <Link href={e.href} className="min-w-0 flex-1 truncate hover:underline">
                    {e.text}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{e.text}</span>
                )}
                <span className="shrink-0 text-muted">{formatDistanceToNowStrict(e.at, { addSuffix: true })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link href={`/clients/${clientId}`} className="flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-sm font-semibold hover:border-accent/50">
        Open full profile <ChevronRight size={16} />
      </Link>
    </div>
  );
}
