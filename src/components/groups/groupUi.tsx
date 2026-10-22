"use client";

import { format, parseISO } from "date-fns";
import { Check, Users, X } from "lucide-react";
import { useState } from "react";
import { bookingLocation } from "@/components/booking/bookingUi";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { decideJoinRequest } from "@/lib/store";
import type { Booking, GroupRequest, GroupSession, GymLocation } from "@/lib/types";
import { cn } from "@/lib/utils";

export function classLocation(g: GroupSession, gyms: GymLocation[]) {
  return bookingLocation({ gymId: g.gymId, customGym: g.customGym, place: g.place }, gyms);
}

/** The only attendee information a client ever sees. */
export function spotsLabel(g: Pick<GroupSession, "spotsLeft" | "capacity">): string {
  return g.spotsLeft === 0 ? `Full — 0 of ${g.capacity} spots left` : `${g.spotsLeft} of ${g.capacity} spots left`;
}

export const classTime = (g: Pick<GroupSession, "start" | "end">) => `${format(parseISO(g.start), "h:mm a")} – ${format(parseISO(g.end), "h:mm a")}`;
export const classTitle = (g: GroupSession) => (g.kind === "SHARED" ? "Partner session" : g.title);

/**
 * A class as a pseudo-booking, so the weekly grid, the clash checks and the travel-time notes treat it like any other
 * session. Its id starts with "g_".
 */
export function classAsBooking(g: GroupSession, viewerId?: string): Booking {
  return {
    id: g.id,
    clientId: g.mine?.status === "CONFIRMED" && viewerId ? viewerId : "other",
    start: g.start,
    end: g.end,
    gymId: g.gymId,
    customGym: g.customGym,
    place: g.place,
    focus: "Full Body",
    notes: g.title,
    status: "CONFIRMED",
    createdBy: "TRAINER",
    createdAt: g.start,
  };
}

/** Coach classes that take up the calendar (shared sessions already have their own booking). */
export function classesAsBookings(groups: GroupSession[], viewerId?: string): Booking[] {
  return groups.filter((g) => g.kind === "CLASS" && g.status !== "CANCELLED").map((g) => classAsBooking(g, viewerId));
}

export function GroupBadge({ g }: { g: GroupSession }) {
  if (g.status === "CANCELLED") return <Badge className="border-line bg-line text-muted">Cancelled</Badge>;
  if (g.status === "COMPLETED") return <Badge className="border-success/30 bg-success/15 text-success">Completed</Badge>;
  if (g.kind === "SHARED") return <Badge className="border-pr/30 bg-pr/15 text-pr">Partner session</Badge>;
  return <Badge className="border-accent/30 bg-accent/15 text-accent">Group class</Badge>;
}

export function SpotsPill({ g, className }: { g: GroupSession; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", g.spotsLeft === 0 ? "text-danger" : "text-success", className)}>
      <Users size={13} /> {spotsLabel(g)}
    </span>
  );
}

/** One join request waiting for an answer from me (the coach or a current attendee). */
export function ApprovalCard({ req, group }: { req: GroupRequest; group?: GroupSession }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async (approve: boolean) => {
    setBusy(true);
    const err = await decideJoinRequest(req.id, approve);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <Card className="space-y-2 border-pr/30 p-3">
      <div className="text-sm">
        <span className="font-semibold">{req.requesterName || "Someone"}</span> wants to join{" "}
        {group ? (
          <>
            <span className="font-semibold">{classTitle(group)}</span> on {format(parseISO(group.start), "EEE d MMM")} · {classTime(group)}
          </>
        ) : (
          "your session"
        )}
        .
      </div>
      <div className="text-xs text-muted">
        {req.approved} of {req.required} approvals so far — they’re only added when the coach and everyone in the session say yes.
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button size="sm" variant="success" disabled={busy} onClick={() => answer(true)}>
          <Check size={14} /> Approve
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={() => answer(false)}>
          <X size={14} /> Decline
        </Button>
      </div>
    </Card>
  );
}
