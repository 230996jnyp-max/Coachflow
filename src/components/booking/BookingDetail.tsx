"use client";

import { format, parseISO } from "date-fns";
import { Check, Clock, MapPin, MessageSquare, Target, UserX, X } from "lucide-react";
import { useState } from "react";
import { GymSelect } from "@/components/GymSelect";
import { Avatar, Button, Field, Input, Modal, Notice } from "@/components/ui";
import { bookingToGymValue, gymToBooking, isGymComplete } from "@/lib/gyms";
import { useViewer } from "@/lib/hooks";
import { atTime, canCancel, ymd } from "@/lib/scheduling";
import { cancelBookingAs, rescheduleBooking, setBookingStatus, useNow } from "@/lib/store";
import { AddToCalendar } from "./CalendarActions";
import { gymName, StatusBadge, timeRange } from "./bookingUi";

/** Details for a single booking. Clients can cancel (inside policy); the trainer can run the whole lifecycle. */
export function BookingDetail({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) {
  return bookingId ? <Detail key={bookingId} bookingId={bookingId} onClose={onClose} /> : null;
}

function Detail({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { db, isTrainer } = useViewer();
  const now = useNow(30_000);
  const b = db.bookings.find((x) => x.id === bookingId);
  const [resched, setResched] = useState(false);
  const [date, setDate] = useState(() => (b ? ymd(parseISO(b.start)) : ""));
  const [time, setTime] = useState(() => (b ? format(parseISO(b.start), "HH:mm") : "09:00"));
  const [gym, setGym] = useState(() => (b ? bookingToGymValue(b) : ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!b) return null;
  const client = db.users.find((u) => u.id === b.clientId);
  const cancelErr = canCancel(b, now, db.settings, isTrainer ? "TRAINER" : "CLIENT");
  const active = b.status === "PENDING" || b.status === "CONFIRMED";
  const charged = b.status === "COMPLETED" || b.status === "NO_SHOW";

  return (
    <Modal open onClose={onClose} title="Session details" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {client && <Avatar name={client.name} size={40} />}
            <div>
              <div className="font-bold">{isTrainer ? client?.name : "Training session"}</div>
              <div className="text-xs text-muted">Booked by {b.createdBy === "TRAINER" ? "trainer" : "client"}</div>
            </div>
          </div>
          <StatusBadge status={b.status} />
        </div>

        <div className="space-y-2.5 rounded-xl border border-line bg-field p-3 text-sm">
          <Line icon={<Clock size={16} />}>
            {format(parseISO(b.start), "EEEE d MMMM yyyy")}
            <div className="text-xs text-muted">{timeRange(b)}</div>
          </Line>
          <Line icon={<MapPin size={16} />}>{gymName(b, db.gyms)}</Line>
          <Line icon={<Target size={16} />}>{b.focus}</Line>
          {b.notes && <Line icon={<MessageSquare size={16} />}>{b.notes}</Line>}
        </div>

        <AddToCalendar booking={b} />

        {isTrainer && b.status === "PENDING" && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="success" onClick={() => { setBookingStatus(b.id, "CONFIRMED"); onClose(); }}>
              <Check size={16} /> Approve
            </Button>
            <Button variant="danger" onClick={() => { setBookingStatus(b.id, "DECLINED"); onClose(); }}>
              <X size={16} /> Decline
            </Button>
          </div>
        )}

        {isTrainer && b.status === "CONFIRMED" && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="success" onClick={() => { setBookingStatus(b.id, "COMPLETED"); onClose(); }}>
              <Check size={16} /> Mark completed
            </Button>
            <Button variant="secondary" onClick={() => { setBookingStatus(b.id, "NO_SHOW"); onClose(); }}>
              <UserX size={16} /> No-show
            </Button>
          </div>
        )}
        {isTrainer && b.status === "CONFIRMED" && (
          <p className="text-xs text-muted">Completing a session deducts 1 credit from the client’s package.</p>
        )}

        {isTrainer && charged && (
          <Button variant="secondary" className="w-full" onClick={() => { setBookingStatus(b.id, "CONFIRMED"); onClose(); }}>
            Undo — return to Confirmed (restores 1 credit)
          </Button>
        )}

        {isTrainer && active && (
          <div className="space-y-3">
            {!resched ? (
              <Button variant="outline" className="w-full" onClick={() => setResched(true)}>
                Reschedule
              </Button>
            ) : (
              <div className="space-y-3 rounded-xl border border-line p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date">
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                  <Field label="Time">
                    <Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
                  </Field>
                </div>
                <Field label="Gym location">
                  <GymSelect value={gym} onChange={setGym} noneLabel="Select a gym…" />
                </Field>
                {error && <Notice tone="error">{error}</Notice>}
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setResched(false)}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={busy}
                    onClick={async () => {
                      if (!gym || !isGymComplete(gym)) return setError("Choose a gym or type the place name.");
                      const loc = gymToBooking(gym, db.gyms);
                      setBusy(true);
                      const err = await rescheduleBooking(b.id, atTime(date, time), loc.gymId, loc.customGym);
                      setBusy(false);
                      if (err) setError(err);
                      else onClose();
                    }}
                  >
                    Save new time
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {active && (
          <>
            {cancelErr && !isTrainer && <Notice tone="warn">{cancelErr}</Notice>}
            <Button
              variant="danger"
              className="w-full"
              disabled={!!cancelErr || busy}
              onClick={async () => {
                setBusy(true);
                const err = await cancelBookingAs(b.id, isTrainer ? "TRAINER" : "CLIENT");
                setBusy(false);
                if (err) setError(err);
                else onClose();
              }}
            >
              Cancel session
            </Button>
          </>
        )}
        {error && !resched && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
