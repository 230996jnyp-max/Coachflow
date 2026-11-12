"use client";

import { format, isSameDay, parseISO } from "date-fns";
import { Check, Clock, MapPin, MessageSquare, Pencil, Share2, Target, X } from "lucide-react";
import { useState } from "react";
import { Button, Field, Modal, Notice, PersonAvatar, Select } from "@/components/ui";
import { LocationPill, MiniMap } from "@/components/LocationPill";
import { directionsUrl, isHomeLocation } from "@/lib/gyms";
import { useViewer } from "@/lib/hooks";
import { canCancel } from "@/lib/scheduling";
import { cancelBookingAs, setBookingStatus, shareSession, unshareSession, useNow } from "@/lib/store";
import Link from "next/link";
import { RollCallPanel } from "@/components/attendance/Attendance";
import { FloorLink } from "@/components/floor/FloorBanner";
import { CoachEyeCard } from "@/components/workout/CoachEyeCard";
import { RecapModal } from "@/components/workout/RecapModal";
import { AddToCalendar } from "./CalendarActions";
import { bookingLocation, StatusBadge, timeRange } from "./bookingUi";
import { EditSessionForm } from "./EditSessionForm";

/** Details for a single booking. Clients can cancel (inside policy); the trainer can run the whole lifecycle. */
export function BookingDetail({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) {
  return bookingId ? <Detail key={bookingId} bookingId={bookingId} onClose={onClose} /> : null;
}

function Detail({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { db, isTrainer } = useViewer();
  const now = useNow(30_000);
  const b = db.bookings.find((x) => x.id === bookingId);
  const [editing, setEditing] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const [groupSize, setGroupSize] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!b) return null;
  const shared = db.groups.find((g) => g.kind === "SHARED" && g.status === "OPEN" && (g.bookingId === b.id || (!isTrainer && g.mine?.role === "OWNER" && g.start === b.start)));
  const partners = shared ? Math.max(0, shared.confirmed - 1) : 0;
  const client = db.users.find((u) => u.id === b.clientId);
  const home = isHomeLocation(b);
  const cancelErr = canCancel(b, now, db.settings, isTrainer ? "TRAINER" : "CLIENT");
  const active = b.status === "PENDING" || b.status === "CONFIRMED";
  const charged = b.status === "COMPLETED" || b.status === "NO_SHOW";
  // Once the session is marked present, the workout done that day can be shared as a recap.
  const dayWorkout = b.status === "COMPLETED" ? db.workouts.find((w) => w.clientId === b.clientId && w.status === "DONE" && isSameDay(parseISO(w.startedAt), parseISO(b.start))) : undefined;

  return (
    <Modal open onClose={onClose} title="Session details" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {client && <PersonAvatar user={client} size={40} />}
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
            {b.place?.address && b.place.address !== b.place.name && !bookingLocation(b, db.gyms).label.includes(b.place.address) && <div className="text-xs text-muted">{b.place.address}</div>}
          </Line>
          <Line icon={<Target size={16} />}>{b.focus}</Line>
          {b.notes && <Line icon={<MessageSquare size={16} />}>{b.notes}</Line>}
        </div>

        {isTrainer && b.status === "CONFIRMED" && <FloorLink sessionKey={b.id} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:brightness-110" />}

        {isTrainer && (active || b.status === "COMPLETED") && <CoachEyeCard clientId={b.clientId} />}

        {dayWorkout && (
          <>
            <Button variant="secondary" className="w-full" onClick={() => setRecapOpen(true)}>
              <Share2 size={16} /> Session recap
            </Button>
            <RecapModal workoutId={dayWorkout.id} open={recapOpen} onClose={() => setRecapOpen(false)} />
          </>
        )}

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

        {!isTrainer && !shared && active && !home && (
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

        {active && (
          <div className="space-y-3">
            {!editing ? (
              <Button variant="outline" className="w-full" onClick={() => setEditing(true)}>
                <Pencil size={16} /> Edit session
              </Button>
            ) : (
              <EditSessionForm booking={b} onCancel={() => setEditing(false)} onDone={onClose} />
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
        {error && !editing && <Notice tone="error">{error}</Notice>}
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
