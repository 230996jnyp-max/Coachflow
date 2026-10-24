"use client";

import { format, parseISO } from "date-fns";
import { Check, Clock, MapPin, MessageSquare, Target, X } from "lucide-react";
import { useState } from "react";
import { GymSelect } from "@/components/GymSelect";
import { Avatar, Button, Field, Input, Modal, Notice, Select, Toggle } from "@/components/ui";
import { LocationPill, MiniMap } from "@/components/LocationPill";
import { classesAsBookings } from "@/components/groups/groupUi";
import { bookingToGymValue, directionsUrl, gymToBooking, isGymComplete, placeForBooking } from "@/lib/gyms";
import type { PlaceInfo } from "@/lib/types";
import { useViewer } from "@/lib/hooks";
import { atTime, canCancel, travelProblem, ymd } from "@/lib/scheduling";
import { locOf } from "@/lib/travel";
import { cancelBookingAs, rescheduleBooking, setBookingStatus, shareSession, unshareSession, useNow } from "@/lib/store";
import Link from "next/link";
import { RollCallPanel } from "@/components/attendance/Attendance";
import { AddToCalendar } from "./CalendarActions";
import { bookingLocation, StatusBadge, timeRange } from "./bookingUi";

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
  const [place, setPlace] = useState<PlaceInfo | null>(() => b?.place ?? null);
  const [waive, setWaive] = useState(false);
  const [groupSize, setGroupSize] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!b) return null;
  const shared = db.groups.find((g) => g.kind === "SHARED" && g.status === "OPEN" && (g.bookingId === b.id || (!isTrainer && g.mine?.role === "OWNER" && g.start === b.start)));
  const partners = shared ? Math.max(0, shared.confirmed - 1) : 0;
  const client = db.users.find((u) => u.id === b.clientId);
  const newStart = atTime(date, time);
  const travel = (() => {
    if (!resched || !gym || !isGymComplete(gym) || Number.isNaN(newStart.getTime())) return null;
    const loc = gymToBooking(gym, db.gyms);
    const end = new Date(newStart.getTime() + db.settings.sessionMinutes * 60000);
    return travelProblem([...db.bookings, ...classesAsBookings(db.groups)], newStart, end, locOf({ gymId: loc.gymId, customGym: loc.customGym, place: placeForBooking(gym, place) ?? undefined }), db.settings, b.id);
  })();
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
          <Line icon={<MapPin size={16} />}>
            <LocationPill label={bookingLocation(b, db.gyms).label} href={bookingLocation(b, db.gyms).href} />
            {b.place?.address && <div className="text-xs text-muted">{b.place.address}</div>}
          </Line>
          <Line icon={<Target size={16} />}>{b.focus}</Line>
          {b.notes && <Line icon={<MessageSquare size={16} />}>{b.notes}</Line>}
        </div>

        {b.place && <MiniMap place={b.place} href={directionsUrl({ place: b.place })} />}

        <AddToCalendar booking={b} />

        {shared && (
          <div className="space-y-2 rounded-xl border border-pr/30 bg-pr/10 p-3 text-sm">
            <div className="font-semibold">Open to a group / partner session</div>
            <div className="text-xs text-muted">
              {isTrainer ? `${partners} partner${partners === 1 ? "" : "s"} joined · ${shared.spotsLeft} of ${shared.capacity} spots left.` : `${shared.spotsLeft} of ${shared.capacity} spots left${partners ? ` · ${partners} partner${partners === 1 ? "" : "s"} joined` : ""}.`}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/classes/${shared.id}`} onClick={onClose}>
                <Button size="sm" variant="secondary">View group session</Button>
              </Link>
              {!isTrainer && partners === 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const err = await unshareSession(shared.id);
                    setBusy(false);
                    if (err) setError(err);
                  }}
                >
                  Stop sharing
                </Button>
              )}
            </div>
          </div>
        )}

        {!isTrainer && !shared && active && (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <div className="text-sm font-semibold">Open to a group / partner session</div>
            <p className="text-xs text-muted">Let other clients ask to join. They’re only added when you and your coach both approve.</p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label="Up to how many people?">
                  <Select value={groupSize} onChange={(e) => setGroupSize(Number(e.target.value))}>
                    {[2, 3, 4, 5, 6, 8].map((n) => (
                      <option key={n} value={n}>
                        {n} people
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const err = await shareSession(b.id, groupSize);
                  setBusy(false);
                  if (err) setError(err);
                }}
              >
                Open it up
              </Button>
            </div>
          </div>
        )}

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

        {isTrainer && (b.status === "CONFIRMED" || charged) && <RollCallPanel target={{ kind: "BOOKING", id: b.id }} />}

        {!isTrainer && b.attendance && (
          <div className="rounded-xl border border-line bg-field p-3 text-sm">
            {b.attendance.mark === "PRESENT" ? "You were marked present — 1 credit used." : b.attendance.deduct ? "You were marked as a no-show — 1 credit was deducted." : "You were marked as a no-show — your credit was returned."}
          </div>
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
                  <GymSelect value={gym} onChange={setGym} noneLabel="Select a gym…" place={place} onPlace={setPlace} />
                </Field>
                {db.settings.travelEnabled && (travel || waive) && (
                  <div className="space-y-1">
                    <Notice tone={waive ? "info" : "warn"}>{waive ? "Travel buffer waived for this change." : travel}</Notice>
                    <Toggle checked={waive} onChange={setWaive} label="Waive travel buffer" />
                  </div>
                )}
                {error && <Notice tone="error">{error}</Notice>}
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setResched(false)}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={busy}
                    onClick={async () => {
                      if (!gym || !isGymComplete(gym)) return setError("Choose a gym and its exact location.");
                      const loc = gymToBooking(gym, db.gyms);
                      if (travel && !waive) return setError(`${travel} Switch on “Waive travel buffer” to save anyway.`);
                      setBusy(true);
                      const err = await rescheduleBooking(b.id, atTime(date, time), loc.gymId, loc.customGym, placeForBooking(gym, place), waive);
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
