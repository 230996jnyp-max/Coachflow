import { bookingToEvent } from "./calendar";
import type { Booking, DB } from "./types";

export interface InviteResult {
  status: "sent" | "preview" | "failed";
  to?: string;
  error?: string;
}

/**
 * Asks the server to email a calendar invite (.ics) for a booking. Gmail/Outlook/Apple Mail show it as an
 * event card with "Add to calendar", and updates/cancellations (same UID, higher SEQUENCE) amend the event.
 */
export async function sendInvite(b: Booking, db: DB, method: "REQUEST" | "CANCEL", recipient: "TRAINER" | "CLIENT"): Promise<InviteResult> {
  const ev = bookingToEvent(b, db, recipient === "TRAINER");
  try {
    // The server looks the recipient up from the signed-in session and the client record — no addresses are sent from the browser.
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        kind: "invite",
        method,
        recipient,
        clientId: b.clientId,
        event: { uid: ev.uid, start: ev.start.toISOString(), end: ev.end.toISOString(), summary: ev.summary, description: ev.description, location: ev.location, rev: ev.rev },
      }),
    });
    if (!res.ok) return { status: "failed", error: `Server returned ${res.status}` };
    const data = (await res.json()) as { result: InviteResult };
    return data.result;
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "Network error" };
  }
}
