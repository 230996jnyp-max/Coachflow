"use client";

import { format } from "date-fns";
import { CalendarCheck, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { GymSelect } from "@/components/GymSelect";
import { Button, Field, Modal, Notice, Select, Textarea } from "@/components/ui";
import { LocationPill, MiniMap } from "@/components/LocationPill";
import { directionsUrl } from "@/lib/gyms";
import { AddToCalendar } from "./CalendarActions";
import { bookingLocation } from "./bookingUi";
import { gymToBooking, isGymComplete, placeForBooking } from "@/lib/gyms";
import { useViewer } from "@/lib/hooks";
import { availableCredits } from "@/lib/scheduling";
import { createBooking } from "@/lib/store";
import type { Booking, PlaceInfo } from "@/lib/types";
import type { SessionFocus } from "@/lib/types";

export const FOCUS_OPTIONS: SessionFocus[] = ["Upper Body", "Lower Body", "Full Body", "Cardio / HIIT", "Mobility & Form Check"];

/** Client tap-to-book modal. `start` is the tapped slot. */
export function BookModal({ start, clientId, onClose }: { start: Date | null; clientId: string; onClose: () => void }) {
  return start ? <Form key={start.getTime()} start={start} clientId={clientId} onClose={onClose} /> : null;
}

function Form({ start, clientId, onClose }: { start: Date; clientId: string; onClose: () => void }) {
  const { db } = useViewer();
  const profile = db.clients.find((c) => c.id === clientId);
  const [gym, setGym] = useState<string>(profile?.defaultGymId ?? "");
  const [place, setPlace] = useState<PlaceInfo | null>(null);
  const [focus, setFocus] = useState<SessionFocus>("Full Body");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);

  if (!profile) return null;
  const avail = availableCredits(profile, db.bookings);

  const submit = async () => {
    setError(null);
    if (!gym) return setError("Please choose where you’ll train.");
    if (!isGymComplete(gym)) return setError("Please choose the exact location (search and pick it, or type the place).");
    const loc = gymToBooking(gym, db.gyms);
    if (busy) return;
    setBusy(true);
    const res = await createBooking({
      clientId,
      start,
      gymId: loc.gymId,
      customGym: loc.customGym,
      place: placeForBooking(gym, place),
      focus,
      notes: notes.trim(),
      createdBy: "CLIENT",
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setBooked(res.booking);
  };

  if (booked) {
    return (
      <Modal open onClose={onClose} title="Session booked" footer={<Button onClick={onClose}>Done</Button>}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 size={48} className="text-success" />
          <div className="text-lg font-bold">{db.settings.autoConfirm ? "You’re booked in!" : "Request sent"}</div>
          <p className="text-sm text-muted">
            {format(start, "EEEE d MMMM · h:mm a")}
            <br />
            {db.settings.autoConfirm ? "A session credit has been reserved for you." : "Your trainer will confirm shortly. A credit is reserved meanwhile."}
          </p>
        </div>
        <div className="mt-3 flex flex-col items-center gap-2 text-sm">
          <LocationPill label={bookingLocation(booked, db.gyms).label} href={bookingLocation(booked, db.gyms).href} />
          {booked.place && <div className="w-full"><MiniMap place={booked.place} href={directionsUrl({ place: booked.place })} /></div>}
        </div>
        <div className="mt-3">
          <AddToCalendar booking={booked} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Book a session"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={avail <= 0 || busy}>
            <CalendarCheck size={16} /> {busy ? "Booking…" : "Confirm booking"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-accent/30 bg-accent/10 p-3 text-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent">{format(start, "EEEE")}</div>
          <div className="text-lg font-bold">{format(start, "d MMMM yyyy")}</div>
          <div className="text-sm text-muted">
            {format(start, "h:mm a")} · {db.settings.sessionMinutes} min
          </div>
        </div>

        {avail <= 0 ? (
          <Notice tone="error">You have no session credits left to book. Ask your trainer to top up your package.</Notice>
        ) : (
          <div className="text-xs text-muted">
            {avail} credit{avail === 1 ? "" : "s"} available — booking reserves 1.
          </div>
        )}

        <Field label="Gym location" hint="Required">
          <GymSelect value={gym} onChange={setGym} noneLabel="Select a gym…" allowPlaces={db.settings.allowCustomGym} place={place} onPlace={setPlace} />
        </Field>
        <Field label="Session focus">
          <Select value={focus} onChange={(e) => setFocus(e.target.value as SessionFocus)}>
            {FOCUS_OPTIONS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </Select>
        </Field>
        <Field label="Notes for trainer">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Want to focus on deadlift form today" />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
