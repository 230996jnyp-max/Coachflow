import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { toUser } from "@/lib/server/accounts";
import { requireUser } from "@/lib/server/auth";
import { decryptJson } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { applyBookingStatus, applyAttendance, clearBookingMark } from "@/lib/server/attendance";
import { notify, onBookingCancelled, onBookingMoved, whenText } from "@/lib/server/groups";
import { badRequest, conflict, forbidden, notFound, readJson, route, str } from "@/lib/server/http";
import { focusAllowed } from "@/lib/sports";
import { hasConflict, loadSchedule, parsePlace, requestLoc, rulesFor, sealDetails, slotAllowed, toBooking, travelCheck } from "@/lib/server/schedule";
import { isHomeLocation } from "@/lib/gyms";
import { bookings, groupSessions, gyms } from "@/lib/server/schema";
import type { BookingStatus, PlaceInfo, SessionFocus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAFF_STATUSES: BookingStatus[] = ["CONFIRMED", "COMPLETED", "NO_SHOW", "DECLINED", "CANCELLED"];

/**
 * PATCH { action } on one booking.
 *  cancel       client (within the notice window) or the coach
 *  status       coach: CONFIRMED | COMPLETED | NO_SHOW | DECLINED | CANCELLED — completing/no-show deducts a credit, undoing restores it
 *  edit         coach or client: { start?, gymId?, customGym?, place?, focus?, notes?, waiveTravel? } - anything left out stays as it is.
 *               A client may change the comments and focus any time before the session; the date, time or place only inside the
 *               notice window, onto an open slot, and never with a waived travel buffer.
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

  if (body.action === "cancel") {
    if (status !== "PENDING" && status !== "CONFIRMED") throw badRequest("This session can no longer be cancelled.");
    if (isClient && row.startAt.getTime() - rules.noticeHours * 3600000 < Date.now()) {
      throw forbidden(`Sessions can only be cancelled ${rules.noticeHours}h or more before they start — message your coach.`);
    }
    const [u] = await d.update(bookings).set({ status: "CANCELLED", rev: row.rev + 1 }).where(eq(bookings.id, id)).returning();
    await clearBookingMark(row);
    await onBookingCancelled(id, row.clientId);
    return NextResponse.json({ booking: toBooking(u) });
  }

  if (body.action === "edit") {
    if (status !== "PENDING" && status !== "CONFIRMED") throw badRequest("Only upcoming sessions can be edited.");
    const old = decryptJson<{ notes: string; customGym?: string; gymId?: string | null; place?: PlaceInfo }>(row.detailsEnc, `booking:${id}`);

    let start = row.startAt;
    if (body.start !== undefined) {
      start = new Date(str(body.start, "Start time", { max: 40 }));
      if (Number.isNaN(start.getTime())) throw badRequest("Invalid start time.");
    }
    const end = new Date(start.getTime() + rules.sessionMinutes * 60000);
    const timeChanged = start.getTime() !== row.startAt.getTime();

    let gymId = old.gymId ?? null;
    let place = old.place;
    let customGym = old.customGym ?? "";
    if ("gymId" in body || "customGym" in body || "place" in body) {
      gymId = typeof body.gymId === "string" && body.gymId ? body.gymId.slice(0, 80) : null;
      place = gymId ? undefined : parsePlace(body.place);
      customGym = gymId ? "" : str(body.customGym, "Location", { optional: true, max: 140 }) || place?.name || "";
      if (!gymId && !customGym) throw badRequest("Please choose a gym location.");
      if (gymId) {
        const [g] = await d.select().from(gyms).where(and(eq(gyms.id, gymId), eq(gyms.coachId, row.coachId))).limit(1);
        if (!g) throw badRequest("Unknown gym.");
      }
    }
    const placeChanged = gymId !== (old.gymId ?? null) || customGym !== (old.customGym ?? "") || (place?.placeId ?? "") !== (old.place?.placeId ?? "");
    const moved = timeChanged || placeChanged;

    const notes = "notes" in body ? str(body.notes, "Comments", { optional: true, max: 500 }) : old.notes;
    let focus = row.focus as SessionFocus;
    if ("focus" in body) {
      if (typeof body.focus !== "string" || !focusAllowed(body.focus, rules.sports)) throw badRequest("Unknown session focus.");
      focus = body.focus;
    }

    if (moved) {
      if (isClient) {
        if (row.startAt.getTime() - rules.noticeHours * 3600000 < Date.now()) {
          throw forbidden(`The date, time and place can only be changed ${rules.noticeHours}h or more before the session — message your coach.`);
        }
        if (timeChanged) {
          if (start.getTime() < Date.now() + rules.noticeHours * 3600000) throw badRequest(`The new time needs at least ${rules.noticeHours}h notice.`);
          const schedule = await loadSchedule(me);
          if (!slotAllowed(start, rules, schedule.slots)) throw badRequest("That time isn't one of your coach's open slots.");
        }
      }
      if (timeChanged && (await hasConflict(row.coachId, start, end, id))) throw conflict("That time overlaps another session.");
      if (isHomeLocation({ customGym, place })) {
        const [shared] = await d.select({ id: groupSessions.id }).from(groupSessions).where(and(eq(groupSessions.bookingId, id), ne(groupSessions.status, "CANCELLED"))).limit(1);
        if (shared) throw badRequest("This session is open to partners. Stop sharing it before moving it to a home address — home sessions stay private.");
      }
      if (!(!isClient && body.waiveTravel === true)) {
        const travel = await travelCheck(row.coachId, start, end, requestLoc({ gymId, customGym, place }), rules, id, !isClient);
        if (travel) throw conflict(travel);
      }
    }

    // A client changing a confirmed session on a coach who approves every booking sends it back for approval.
    const nextStatus: BookingStatus = moved && isClient && status === "CONFIRMED" && !rules.autoConfirm ? "PENDING" : status;
    const [u] = await d
      .update(bookings)
      .set({ startAt: start, endAt: end, focus, status: nextStatus, rev: row.rev + 1, detailsEnc: sealDetails(id, { notes, customGym: customGym || undefined, gymId, place }) })
      .where(eq(bookings.id, id))
      .returning();
    if (moved) {
      await onBookingMoved(id, start, end, { gymId, customGym: customGym || undefined, place });
      const when = await whenText(row.coachId, start);
      if (isClient) {
        await notify([row.coachId], "booking_changed", { title: "A client changed their session", body: `${toUser(me).name} moved their session to ${when}${nextStatus === "PENDING" ? " — it needs your approval again" : ""}.`, link: "/schedule" }, { email: false });
      } else {
        await notify([row.clientId], "booking_changed", { title: "Your session was updated", body: `Your coach changed your session — it is now ${when}.`, link: "/book" }, { email: false });
      }
    }
    return NextResponse.json({ booking: toBooking(u), moved });
  }

  if (isClient) throw forbidden();

  if (body.action === "status") {
    const next = body.status as BookingStatus;
    if (!STAFF_STATUSES.includes(next)) throw badRequest("Unknown status.");
    if (next === "COMPLETED" || next === "NO_SHOW") await applyBookingStatus(me, id, next);
    else if (next === "CONFIRMED" && (status === "COMPLETED" || status === "NO_SHOW")) await applyAttendance(me, { kind: "BOOKING", id, reopen: true });
    else {
      if (next === "CANCELLED" || next === "DECLINED") await clearBookingMark(row);
      await d.update(bookings).set({ status: next, rev: next === "CANCELLED" || next === "DECLINED" ? row.rev + 1 : row.rev }).where(and(eq(bookings.id, id), eq(bookings.coachId, me.id)));
      // A session opened to partners: a cancellation passes it on to the first partner.
      if (next === "CANCELLED" || next === "DECLINED") await onBookingCancelled(id, row.clientId);
    }
    const [u] = await d.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return NextResponse.json({ booking: toBooking(u) });
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
    await onBookingMoved(id, start, end, { gymId, customGym: customGym || undefined, place });
    return NextResponse.json({ booking: toBooking(u) });
  }

  throw badRequest("Unknown action.");
});
