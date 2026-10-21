import { parseISO } from "date-fns";
import type { Booking, DB } from "./types";
import type { IcsEvent } from "./ics";

/** Maps a booking to a calendar event from the point of view of the viewer (trainer sees the client's name). */
export function bookingToEvent(b: Booking, db: DB, viewerIsTrainer: boolean): IcsEvent {
  const client = db.users.find((u) => u.id === b.clientId);
  const coachId = db.clients.find((c) => c.id === b.clientId)?.coachId;
  const trainer = db.users.find((u) => u.id === coachId) ?? db.users.find((u) => u.role === "TRAINER");
  const gym = b.customGym || db.gyms.find((g) => g.id === b.gymId)?.name || "Location TBC";
  const who = viewerIsTrainer ? client?.name ?? "Client" : trainer?.name ?? "Your trainer";
  return {
    uid: b.id,
    start: parseISO(b.start),
    end: parseISO(b.end),
    summary: viewerIsTrainer ? `PT session — ${who}` : `PT session with ${who}`,
    description: [`Focus: ${b.focus}`, b.notes ? `Notes: ${b.notes}` : "", `Booked with ${db.settings.brandName}`].filter(Boolean).join("\n"),
    location: gym,
    rev: b.rev ?? 0,
    cancelled: b.status === "CANCELLED" || b.status === "DECLINED",
  };
}
