"use client";

import { format } from "date-fns";
import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { GymSelect } from "@/components/GymSelect";
import { TimeSelect } from "@/components/TimeSelect";
import { Button, Field, Input, Modal, Notice, Select, Textarea, Toggle } from "@/components/ui";
import { directionsUrl, gymToBooking, isGymComplete, isHomeValue, placeForBooking } from "@/lib/gyms";
import { useViewer } from "@/lib/hooks";
import { atTime, availableCredits, travelProblem, ymd } from "@/lib/scheduling";
import { locOf } from "@/lib/travel";
import { createBooking } from "@/lib/store";
import { LocationPill, MiniMap } from "@/components/LocationPill";
import { classesAsBookings } from "@/components/groups/groupUi";
import type { Booking, PlaceInfo, SessionFocus } from "@/lib/types";
import { bookingLocation } from "./bookingUi";
import { AddToCalendar } from "./CalendarActions";
import { FOCUS_OPTIONS } from "./BookModal";

export interface TrainerBookInit {
  start?: Date;
  clientId?: string;
}

/** Trainer books a client into any slot — inside or outside published availability. */
export function TrainerBookModal({ init, onClose }: { init: TrainerBookInit | null; onClose: () => void }) {
  return init ? <Form key={init.start?.getTime() ?? "new"} init={init} onClose={onClose} /> : null;
}

function Form({ init, onClose }: { init: TrainerBookInit; onClose: () => void }) {
  const { db, clients } = useViewer();
  const active = clients.filter((c) => !c.profile.archived);
  const [clientId, setClientId] = useState(init.clientId ?? active[0]?.user.id ?? "");
  const [date, setDate] = useState(() => ymd(init.start ?? new Date()));
  const [time, setTime] = useState(() => (init.start ? format(init.start, "HH:mm") : "09:00"));
  const profile = db.clients.find((c) => c.id === clientId);
  const [gym, setGym] = useState<string>(profile?.defaultGymId ?? "");
  const [place, setPlace] = useState<PlaceInfo | null>(null);
  const [waive, setWaive] = useState(false);
  const [focus, setFocus] = useState<SessionFocus>("Full Body");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);

  const avail = profile ? availableCredits(profile, db.bookings) : 0;

  // Travel time between sessions at different locations (the coach can waive it for one booking).
  const sessionStart = atTime(date, time);
  const problem = (() => {
    if (!gym || !isGymComplete(gym) || Number.isNaN(sessionStart.getTime())) return null;
    const loc = gymToBooking(gym, db.gyms);
    const end = new Date(sessionStart.getTime() + db.settings.sessionMinutes * 60000);
    return travelProblem([...db.bookings, ...classesAsBookings(db.groups)], sessionStart, end, locOf({ gymId: loc.gymId, customGym: loc.customGym, place: placeForBooking(gym, place) ?? undefined }), db.settings);
  })();

  if (booked) {
    return (
      <Modal open onClose={onClose} title="Session booked" footer={<Button onClick={onClose}>Done</Button>}>
        <div className="space-y-4">
          <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-center text-sm">
            <div className="font-bold">{db.users.find((u) => u.id === booked.clientId)?.name ?? "Client"}</div>
            <div className="text-muted">{format(new Date(booked.start), "EEEE d MMMM · h:mm a")}</div>
          </div>
          <div className="flex flex-col items-center gap-2 text-sm">
            <LocationPill label={bookingLocation(booked, db.gyms).label} href={bookingLocation(booked, db.gyms).href} />
            {booked.place && <div className="w-full"><MiniMap place={booked.place} href={directionsUrl({ place: booked.place })} /></div>}
          </div>
          <AddToCalendar booking={booked} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Book a client"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!clientId || busy}
            onClick={async () => {
              setError(null);
              if (!gym) return setError("Please choose a gym or place.");
              if (!isGymComplete(gym)) return setError("Please choose the exact location (search and pick it, or type the place).");
              const loc = gymToBooking(gym, db.gyms);
              if (problem && !waive) return setError(`${problem} Switch on “Waive travel buffer” to book anyway.`);
              setBusy(true);
              const res = await createBooking({
                clientId,
                start: atTime(date, time),
                gymId: loc.gymId,
                customGym: loc.customGym,
                place: placeForBooking(gym, place),
                waiveTravel: waive,
                focus,
                notes: notes.trim(),
                createdBy: "TRAINER",
              });
              setBusy(false);
              if (!res.ok) setError(res.error);
              else setBooked(res.booking);
            }}
          >
            <CalendarPlus size={16} /> {busy ? "Booking…" : "Book session"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Client">
          <Select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              const p = db.clients.find((c) => c.id === e.target.value);
              if (p?.defaultGymId) {
                setGym(p.defaultGymId);
                setPlace(null);
              } else if (isHomeValue(gym)) {
                // A home address belongs to one client.
                setGym("");
                setPlace(null);
              }
            }}
          >
            {active.map((c) => (
              <option key={c.user.id} value={c.user.id}>
                {c.user.name}
              </option>
            ))}
          </Select>
        </Field>
        {profile && avail <= 0 && <Notice tone="warn">{`This client has no unreserved credits left (${profile.credits} remaining, all reserved). You can still book — top up their package afterwards.`}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start time">
            <TimeSelect value={time} onChange={setTime} />
          </Field>
        </div>
        <Field label="Gym location">
          <GymSelect value={gym} onChange={setGym} noneLabel="Select a gym…" place={place} onPlace={setPlace} homeClientId={clientId || undefined} />
        </Field>
        {db.settings.travelEnabled && (problem || waive) && (
          <div className="space-y-1">
            <Notice tone={waive ? "info" : "warn"}>{waive ? "Travel buffer waived for this booking." : problem}</Notice>
            <Toggle checked={waive} onChange={setWaive} label="Waive travel buffer" />
          </div>
        )}
        <Field label="Session focus">
          <Select value={focus} onChange={(e) => setFocus(e.target.value as SessionFocus)}>
            {FOCUS_OPTIONS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
