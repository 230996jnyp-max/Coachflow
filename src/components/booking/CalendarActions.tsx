"use client";

import { CalendarArrowDown, CalendarPlus, Mail } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { bookingToEvent } from "@/lib/calendar";
import { useViewer } from "@/lib/hooks";
import { buildIcs, downloadIcs, googleCalendarUrl, outlookCalendarUrl } from "@/lib/ics";
import { sendInvite, type InviteResult } from "@/lib/notify";
import { ACTIVE_UPCOMING } from "@/lib/scheduling";
import type { Booking } from "@/lib/types";

/** Add a single session to Google / Outlook / Apple calendars, or email the invite. */
export function AddToCalendar({ booking }: { booking: Booking }) {
  const { db, isTrainer } = useViewer();
  const [result, setResult] = useState<InviteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const ev = bookingToEvent(booking, db, isTrainer);
  const active = ACTIVE_UPCOMING.includes(booking.status);
  if (!active) return null;

  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Add to your calendar</div>
      <div className="grid grid-cols-2 gap-2">
        <a href={googleCalendarUrl(ev)} target="_blank" rel="noreferrer">
          <Button variant="secondary" size="sm" className="w-full">
            <CalendarPlus size={14} /> Google
          </Button>
        </a>
        <a href={outlookCalendarUrl(ev)} target="_blank" rel="noreferrer">
          <Button variant="secondary" size="sm" className="w-full">
            <CalendarPlus size={14} /> Outlook
          </Button>
        </a>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadIcs(`coachflow-session-${booking.id}.ics`, buildIcs([ev], { calName: "CoachFlow sessions" }))}
        >
          <CalendarArrowDown size={14} /> Apple / .ics
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setResult(await sendInvite(booking, db, "REQUEST", isTrainer ? "TRAINER" : "CLIENT"));
            setBusy(false);
          }}
        >
          <Mail size={14} /> {busy ? "Sending…" : "Email me invite"}
        </Button>
      </div>
      <p className="text-[11px] text-muted">Downloaded events include reminders 24 hours and 1 hour before the session.</p>
      {result && <InviteStatus r={result} />}
    </div>
  );
}

export function InviteStatus({ r }: { r: InviteResult }) {
  if (r.status === "sent") return <p className="text-xs text-success">Invite emailed to {r.to}. Open it in Gmail and tap “Add to calendar”.</p>;
  if (r.status === "preview") return <p className="text-xs text-pr">Email delivery isn’t set up on this server, so the invite was only previewed (see README → Email setup).</p>;
  return <p className="text-xs text-danger">Couldn’t send: {r.error ?? "unknown error"}</p>;
}

/** Download every upcoming session as one .ics file (imports into any calendar app). */
export function SyncAllButton({ clientId }: { clientId?: string }) {
  const { db, isTrainer } = useViewer();
  const upcoming = db.bookings.filter(
    (b) => ACTIVE_UPCOMING.includes(b.status) && new Date(b.end) > new Date() && (!clientId || b.clientId === clientId),
  );
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={upcoming.length === 0}
      onClick={() =>
        downloadIcs(
          "coachflow-sessions.ics",
          buildIcs(
            upcoming.map((b) => bookingToEvent(b, db, isTrainer)),
            { calName: `${db.settings.brandName} sessions` },
          ),
        )
      }
    >
      <CalendarArrowDown size={14} /> Sync calendar ({upcoming.length})
    </Button>
  );
}

/** Compact one-tap actions for session cards: Google Calendar link + .ics download. */
export function CalendarQuickLinks({ booking }: { booking: Booking }) {
  const { db, isTrainer } = useViewer();
  if (!ACTIVE_UPCOMING.includes(booking.status)) return null;
  const ev = bookingToEvent(booking, db, isTrainer);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={googleCalendarUrl(ev)} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-field px-3 text-xs font-semibold text-ink hover:bg-line">
        <CalendarPlus size={13} /> Google Calendar
      </a>
      <button
        onClick={() => downloadIcs(`coachflow-session-${booking.id}.ics`, buildIcs([ev], { calName: "CoachFlow sessions" }))}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-field px-3 text-xs font-semibold text-ink hover:bg-line"
      >
        <CalendarArrowDown size={13} /> Apple / .ics
      </button>
    </div>
  );
}
