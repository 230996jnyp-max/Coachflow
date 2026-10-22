import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { loadClientFor } from "@/lib/server/accounts";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { badRequest, conflict, notFound, readJson, route, str } from "@/lib/server/http";
import { clientCredits, FOCUS, hasConflict, parsePlace, reservedCount, rulesFor, sealDetails, slotAllowed, toBooking, loadSchedule } from "@/lib/server/schedule";
import { bookings, gyms } from "@/lib/server/schema";
import { and, eq } from "drizzle-orm";
import type { SessionFocus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — book a session. A client books into their own coach's open slots; a coach books any of their clients at any time. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  const isClient = me.role === "CLIENT";

  let client = me;
  let coachId: string | null = me.coachId;
  if (!isClient) {
    const found = await loadClientFor(me, str(body.clientId, "Client", { max: 80 }));
    if (!found) throw notFound("Client not found.");
    client = found;
    coachId = me.id;
  }
  if (!coachId) throw badRequest("No coach is assigned to this account.");

  const rules = await rulesFor(coachId);
  const start = new Date(str(body.start, "Start time", { max: 40 }));
  if (Number.isNaN(start.getTime())) throw badRequest("Invalid start time.");
  const end = new Date(start.getTime() + rules.sessionMinutes * 60000);

  const focus: SessionFocus = FOCUS.includes(body.focus as SessionFocus) ? (body.focus as SessionFocus) : "Full Body";
  const gymId = typeof body.gymId === "string" && body.gymId ? body.gymId.slice(0, 80) : null;
  const place = gymId ? undefined : parsePlace(body.place);
  const customGym = str(body.customGym, "Location", { optional: true, max: 140 }) || place?.name || "";
  const notes = str(body.notes, "Notes", { optional: true, max: 500 });
  if (!gymId && !customGym) throw badRequest("Please choose a gym location.");

  const d = await db();
  if (gymId) {
    const [g] = await d.select().from(gyms).where(and(eq(gyms.id, gymId), eq(gyms.coachId, coachId))).limit(1);
    if (!g) throw badRequest("That gym isn't one of your coach's locations.");
  }

  if (isClient) {
    if (start.getTime() < Date.now() + rules.noticeHours * 3600000) throw badRequest(`Bookings need at least ${rules.noticeHours}h notice.`);
    const schedule = await loadSchedule(me);
    if (!slotAllowed(start, rules, schedule.slots)) throw badRequest("That time isn't one of your coach's open slots.");
    const available = clientCredits(client) - (await reservedCount(client.id));
    if (available <= 0) throw badRequest("No session credits left. Ask your coach to top up your package.");
  }
  if (await hasConflict(coachId, start, end)) throw conflict("That time overlaps another session.");

  const id = `b_${randomUUID()}`;
  const [row] = await d
    .insert(bookings)
    .values({
      id,
      coachId,
      clientId: client.id,
      startAt: start,
      endAt: end,
      status: isClient && !rules.autoConfirm ? "PENDING" : "CONFIRMED",
      focus,
      createdBy: isClient ? "CLIENT" : "TRAINER",
      detailsEnc: sealDetails(id, { notes, customGym: customGym || undefined, gymId, place }),
    })
    .returning();
  return NextResponse.json({ booking: toBooking(row) });
});
