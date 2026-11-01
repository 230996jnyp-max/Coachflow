"use client";

import { format, parseISO } from "date-fns";
import { useState } from "react";
import { GymSelect } from "@/components/GymSelect";
import { TimeSelect } from "@/components/TimeSelect";
import { classesAsBookings, withPartnerSessions } from "@/components/groups/groupUi";
import { Button, Field, Input, Notice, Select, Textarea, Toggle } from "@/components/ui";
import { bookingToGymValue, gymToBooking, isGymComplete, placeForBooking } from "@/lib/gyms";
import { useViewer } from "@/lib/hooks";
import { focusOptions } from "@/lib/sports";
import { atTime, buildDaySlots, travelProblem, ymd } from "@/lib/scheduling";
import { editBooking, useNow } from "@/lib/store";
import { locOf } from "@/lib/travel";
import type { Booking, PlaceInfo, SessionFocus } from "@/lib/types";

/**
 * Edit one upcoming session: date, time, location, focus and comments in a single form (no delete-and-rebook).
 * The coach may change anything. A client may always change the focus and comments; the date, time and place only
 * outside the notice window, onto an open slot, and without waiving the coach's travel time.
 */
export function EditSessionForm({ booking: b, onDone, onCancel }: { booking: Booking; onDone: () => void; onCancel: () => void }) {
  const { db, isTrainer } = useViewer();
  const now = useNow(60_000);
  const initialGym = bookingToGymValue(b);
  const [date, setDate] = useState(() => ymd(parseISO(b.start)));
  const [time, setTime] = useState(() => format(parseISO(b.start), "HH:mm"));
  const [gym, setGym] = useState(initialGym);
  const [place, setPlace] = useState<PlaceInfo | null>(() => b.place ?? null);
  const [focus, setFocus] = useState<SessionFocus>(b.focus);
  const [notes, setNotes] = useState(b.notes);
  const [waive, setWaive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A client can't move or re-place a session inside the notice window.
  const frozen = !isTrainer && parseISO(b.start).getTime() - db.settings.noticeHours * 3600000 < now.getTime();
  const start = atTime(date, time);
  const timeChanged = !frozen && !Number.isNaN(start.getTime()) && start.getTime() !== parseISO(b.start).getTime();
  const gymChanged = !frozen && (gym !== initialGym || (place?.placeId ?? "") !== (b.place?.placeId ?? ""));

  // Clients pick from the coach's open slots on the chosen day (their own slot counts as free).
  const openTimes = isTrainer
    ? []
    : buildDaySlots(atTime(date, "00:00"), { slots: db.slots, bookings: withPartnerSessions(db.bookings.filter((x) => x.id !== b.id), db.groups, b.clientId), settings: db.settings }, { now, clientId: b.clientId, role: "CLIENT", travel: null })
        .filter((s) => s.state === "open")
        .map((s) => format(s.start, "HH:mm"));
  const timeOptions = openTimes.includes(time) || date !== ymd(parseISO(b.start)) ? openTimes : [...openTimes, time].sort();

  const travel = (() => {
    if ((!timeChanged && !gymChanged) || !gym || !isGymComplete(gym) || Number.isNaN(start.getTime())) return null;
    const loc = gymToBooking(gym, db.gyms);
    const end = new Date(start.getTime() + db.settings.sessionMinutes * 60000);
    return travelProblem([...db.bookings, ...classesAsBookings(db.groups)], start, end, locOf({ gymId: loc.gymId, customGym: loc.customGym, place: placeForBooking(gym, place) ?? undefined }), db.settings, b.id);
  })();

  const save = async () => {
    setError(null);
    if (gymChanged && (!gym || !isGymComplete(gym))) return setError("Choose where you’ll train and its exact location.");
    if (travel && !waive) return setError(isTrainer ? `${travel} Switch on “Waive travel buffer” to save anyway.` : travel);
    const loc = gymChanged ? gymToBooking(gym, db.gyms) : null;
    setBusy(true);
    const err = await editBooking(
      b.id,
      {
        ...(timeChanged ? { start } : {}),
        ...(loc ? { gymId: loc.gymId, customGym: loc.customGym, place: placeForBooking(gym, place) } : {}),
        focus,
        notes: notes.trim(),
        waiveTravel: isTrainer && waive,
      },
      isTrainer ? "TRAINER" : "CLIENT",
    );
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <div className="text-sm font-bold">Edit session</div>
      {frozen ? (
        <Notice tone="warn">{`The date, time and place can only be changed ${db.settings.noticeHours}h or more before the session — message your coach. You can still update the focus and comments.`}</Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Time">
              {isTrainer ? (
                <TimeSelect value={time} onChange={setTime} />
              ) : (
                <Select aria-label="Time" value={timeOptions.includes(time) ? time : ""} onChange={(e) => setTime(e.target.value)}>
                  {!timeOptions.includes(time) && (
                    <option value="" disabled>
                      No open times
                    </option>
                  )}
                  {timeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {!isTrainer && timeOptions.length === 0 && <p className="text-xs text-muted">Your coach has no open times on this day — pick another date.</p>}
          <Field label="Location">
            <GymSelect value={gym} onChange={setGym} noneLabel="Select a gym…" allowPlaces={isTrainer || db.settings.allowCustomGym} place={place} onPlace={setPlace} homeClientId={b.clientId} />
          </Field>
          {db.settings.travelEnabled && (travel || waive) && (
            <div className="space-y-1">
              <Notice tone={waive ? "info" : "warn"}>{waive ? "Travel buffer waived for this change." : travel}</Notice>
              {isTrainer && <Toggle checked={waive} onChange={setWaive} label="Waive travel buffer" />}
            </div>
          )}
        </>
      )}
      <Field label="Session focus">
        <Select value={focus} onChange={(e) => setFocus(e.target.value as SessionFocus)}>
          {[...new Set([...focusOptions(db.settings.specialties ?? []), b.focus])].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </Select>
      </Field>
      <Field label={isTrainer ? "Comments" : "Notes for your trainer"}>
        <Textarea value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Want to focus on deadlift form today" />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="flex-1" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
