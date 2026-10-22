import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { decryptJson } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { badRequest, conflict, forbidden, notFound, readJson, route, str } from "@/lib/server/http";
import { adjustCredits, CHARGED, clientCredits, hasConflict, parsePlace, requestLoc, rulesFor, sealDetails, toBooking, travelCheck } from "@/lib/server/schedule";
import { bookings, gyms, users } from "@/lib/server/schema";
import type { BookingStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAFF_STATUSES: BookingStatus[] = ["CONFIRMED", "COMPLETED", "NO_SHOW", "DECLINED", "CANCELLED"];

/**
 * PATCH { action } on one booking.
 *  cancel       client (within the notice window) or the coach
 *  status       coach: CONFIRMED | COMPLETED | NO_SHOW | DECLINED | CANCELLED — completing/no-show deducts a credit, undoing restores it
 *  reschedule   coach: { start, gymId?, customGym?, place?, waiveTravel? }
 */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  const d = await db();
  const [row] = await d.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  const isClient = me.role === "CLIENT";
  if (!row || (isClient ? row.clientId !== me.id : row.coachId !== me.id)) throw notFound("Booking not found.");

  const rules = await rulesFor(row.coachId);
  const status = row.status as BookingStatus;
  const [clientRow] = await d.select().from(users).where(eq(users.id, row.clientId)).limit(1);
  let credits: number | undefined;

  if (body.action === "cancel") {
    if (status !== "PENDING" && status !== "CONFIRMED") throw badRequest("This session can no longer be cancelled.");
    if (isClient && row.startAt.getTime() - rules.noticeHours * 3600000 < Date.now()) {
      throw forbidden(`Sessions can only be cancelled ${rules.noticeHours}h or more before they start — message your coach.`);
    }
    const [u] = await d.update(bookings).set({ status: "CANCELLED", rev: row.rev + 1 }).where(eq(bookings.id, id)).returning();
    return NextResponse.json({ booking: toBooking(u) });
  }

  if (isClient) throw forbidden();

  if (body.action === "status") {
    const next = body.status as BookingStatus;
    if (!STAFF_STATUSES.includes(next)) throw badRequest("Unknown status.");
    const delta = CHARGED.includes(next) && !CHARGED.includes(status) ? -1 : !CHARGED.includes(next) && CHARGED.includes(status) ? 1 : 0;
    const [u] = await d
      .update(bookings)
      .set({ status: next, rev: next === "CANCELLED" || next === "DECLINED" ? row.rev + 1 : row.rev })
      .where(and(eq(bookings.id, id), eq(bookings.coachId, me.id)))
      .returning();
    if (clientRow) credits = delta ? await adjustCredits(clientRow, delta) : clientCredits(clientRow);
    return NextResponse.json({ booking: toBooking(u), credits });
  }

  if (body.action === "reschedule") {
    if (status !== "PENDING" && status !== "CONFIRMED") throw badRequest("Only upcoming sessions can be rescheduled.");
    const start = new Date(str(body.start, "Start time", { max: 40 }));
    if (Number.isNaN(start.getTime())) throw badRequest("Invalid start time.");
    const end = new Date(start.getTime() + rules.sessionMinutes * 60000);
    if (await hasConflict(row.coachId, start, end, id)) throw conflict("That time overlaps another session.");

    const old = decryptJson<{ notes: string; customGym?: string; gymId?: string | null }>(row.detailsEnc, `booking:${id}`);
    const gymId = typeof body.gymId === "string" && body.gymId ? body.gymId.slice(0, 80) : null;
    const place = gymId ? undefined : parsePlace(body.place);
    const customGym = str(body.customGym, "Location", { optional: true, max: 140 }) || place?.name || "";
    if (!gymId && !customGym) throw badRequest("Please choose a gym location.");
    if (gymId) {
      const [g] = await d.select().from(gyms).where(and(eq(gyms.id, gymId), eq(gyms.coachId, me.id))).limit(1);
      if (!g) throw badRequest("Unknown gym.");
    }
    if (body.waiveTravel !== true) {
      const travel = await travelCheck(row.coachId, start, end, requestLoc({ gymId, customGym, place }), rules, id, true);
      if (travel) throw conflict(travel);
    }
    const [u] = await d
      .update(bookings)
      .set({ startAt: start, endAt: end, rev: row.rev + 1, detailsEnc: sealDetails(id, { notes: old.notes, customGym: customGym || undefined, gymId, place }) })
      .where(eq(bookings.id, id))
      .returning();
    return NextResponse.json({ booking: toBooking(u) });
  }

  throw badRequest("Unknown action.");
});
