import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { lowCreditAfter } from "./creditAlerts";
import { attendanceFor, attKey, setMark, type Mark, type Pool, type SessionKind } from "./credits";
import { db } from "./db";
import { badRequest, forbidden, notFound } from "./http";
import { notify, openGroup, whenText } from "./groups";
import { bookings, groupMembers, groupSessions, type BookingRow, type GroupRow, type UserRow } from "./schema";

/*
 * Attendance roll call for 1-on-1 sessions, group classes and partner sessions (one list per session).
 *  - Marking someone Present takes one credit; No-Show gives it back unless the coach chose "deduct anyway".
 *  - A mark can be changed any time (start of class, end of class, or later by the coach): the credit moves only by the
 *    difference (see credits.ts), and the session's status follows the marks once it has been finalised.
 */

export interface MarkInput {
  clientId: string;
  mark: Mark | "CLEAR";
  deduct?: boolean;
}

interface Participant {
  clientId: string;
  role: "OWNER" | "MEMBER";
  pool: Pool;
  kind: SessionKind;
  sessionId: string;
  legacy?: { mark: Mark; charged: boolean };
}

interface Ctx {
  coachId: string;
  sessionType: string;
  label: string;
  start: Date;
  booking?: BookingRow;
  group?: GroupRow;
  finalized: boolean;
  participants: Participant[];
}

async function sharedGroupFor(bookingId: string): Promise<GroupRow | null> {
  const d = await db();
  const [g] = await d.select().from(groupSessions).where(and(eq(groupSessions.bookingId, bookingId), ne(groupSessions.status, "CANCELLED"))).limit(1);
  return g ?? null;
}

async function bookingCtx(me: UserRow, bookingId: string): Promise<Ctx> {
  const d = await db();
  const [row] = await d.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!row || row.coachId !== me.id) throw notFound("Session not found.");
  const group = await sharedGroupFor(bookingId);
  const when = await whenText(row.coachId, row.startAt);
  const legacy = row.status === "COMPLETED" ? { mark: "PRESENT" as Mark, charged: true } : row.status === "NO_SHOW" ? { mark: "NO_SHOW" as Mark, charged: true } : undefined;
  const participants: Participant[] = [{ clientId: row.clientId, role: "OWNER", pool: group ? "GROUP" : "SESSION", kind: "BOOKING", sessionId: row.id, legacy }];
  if (group) {
    const members = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.role, "MEMBER"), inArray(groupMembers.status, ["CONFIRMED", "ATTENDED", "ABSENT"])));
    for (const m of members) participants.push({ clientId: m.clientId, role: "MEMBER", pool: "GROUP", kind: "GROUP", sessionId: group.id });
  }
  return { coachId: row.coachId, sessionType: group ? "Group Class" : "1-on-1 PT", label: group ? `Partner session · ${when}` : `1-on-1 session · ${when}`, start: row.startAt, booking: row, group: group ?? undefined, finalized: row.status === "COMPLETED" || row.status === "NO_SHOW", participants };
}

async function groupCtx(me: UserRow, groupId: string): Promise<Ctx> {
  const d = await db();
  const [g] = await d.select().from(groupSessions).where(eq(groupSessions.id, groupId)).limit(1);
  if (!g || g.coachId !== me.id) throw notFound("Class not found.");
  if (g.kind === "SHARED" && g.bookingId) return bookingCtx(me, g.bookingId);
  const members = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.role, "MEMBER"), inArray(groupMembers.status, ["CONFIRMED", "ATTENDED", "ABSENT"])));
  const participants: Participant[] = members.map((m) => ({ clientId: m.clientId, role: "MEMBER", pool: "GROUP", kind: "GROUP", sessionId: g.id }));
  return { coachId: g.coachId, sessionType: "Group Class", label: openGroup(g).title, start: g.startAt, group: g, finalized: g.status === "COMPLETED", participants };
}

async function currentMarks(ctx: Ctx) {
  const book = await attendanceFor("BOOKING", ctx.participants.filter((p) => p.kind === "BOOKING").map((p) => p.sessionId));
  const grp = await attendanceFor("GROUP", ctx.participants.filter((p) => p.kind === "GROUP").map((p) => p.sessionId));
  return new Map([...book, ...grp]);
}

/** After the session is finalised: the booking / class and each person's status follow their attendance mark. */
async function syncStatuses(ctx: Ctx, status: "finalised" | "open") {
  const d = await db();
  const marks = await currentMarks(ctx);
  const markOf = (p: Participant) => marks.get(attKey(p.kind, p.sessionId, p.clientId))?.mark as Mark | undefined;
  const now = status === "finalised";
  if (ctx.booking) {
    const owner = ctx.participants[0];
    const m = markOf(owner);
    const next = !now ? "CONFIRMED" : m === "NO_SHOW" ? "NO_SHOW" : "COMPLETED";
    await d.update(bookings).set({ status: next, rev: ctx.booking.rev }).where(eq(bookings.id, ctx.booking.id));
  }
  if (ctx.group) {
    const g = ctx.group;
    for (const p of ctx.participants.filter((x) => x.kind === "GROUP")) {
      const m = markOf(p);
      await d.update(groupMembers).set({ status: !now ? "CONFIRMED" : m === "NO_SHOW" ? "ABSENT" : "ATTENDED" }).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.clientId, p.clientId)));
    }
    if (now) await d.update(groupMembers).set({ status: "CANCELLED" }).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.status, "WAITLIST")));
    await d.update(groupSessions).set({ status: now ? "COMPLETED" : "OPEN", rev: g.rev + 1 }).where(eq(groupSessions.id, g.id));
  }
}

/**
 * Marks people present / no-show, and optionally finalises the session (or re-opens it). Returns nothing: the browser
 * re-reads the schedule, classes and credits afterwards.
 */
export async function applyAttendance(me: UserRow, input: { kind: SessionKind; id: string; marks?: MarkInput[]; finalize?: boolean; reopen?: boolean }): Promise<void> {
  if (me.role === "CLIENT") throw forbidden();
  const ctx = input.kind === "BOOKING" ? await bookingCtx(me, input.id) : await groupCtx(me, input.id);
  if (ctx.booking && (ctx.booking.status === "CANCELLED" || ctx.booking.status === "DECLINED")) throw badRequest("That session was cancelled.");
  if (ctx.group && !ctx.booking && ctx.group.status === "CANCELLED") throw badRequest("That class was cancelled.");

  if (input.reopen) {
    if (!ctx.finalized) throw badRequest("This session is already open.");
    // Sessions finished before attendance existed already took their credit: keep that state as a mark.
    for (const p of ctx.participants) if (p.legacy) await setMark({ kind: p.kind, sessionId: p.sessionId, coachId: ctx.coachId, clientId: p.clientId, pool: p.pool, mark: p.legacy.mark, deduct: p.legacy.mark === "NO_SHOW" && p.legacy.charged, sessionType: ctx.sessionType, label: ctx.label, legacy: p.legacy });
    await syncStatuses(ctx, "open");
    return;
  }

  const byId = new Map(ctx.participants.map((p) => [p.clientId, p]));
  const told: { clientId: string; deduct: boolean }[] = [];
  for (const m of input.marks ?? []) {
    const p = byId.get(m.clientId);
    if (!p) throw badRequest("That person isn't part of this session.");
    if (m.mark !== "PRESENT" && m.mark !== "NO_SHOW" && m.mark !== "CLEAR") throw badRequest("Choose Present or No-Show.");
    const res = await setMark({ kind: p.kind, sessionId: p.sessionId, coachId: ctx.coachId, clientId: p.clientId, pool: p.pool, mark: m.mark, deduct: m.mark === "NO_SHOW" && m.deduct === true, sessionType: ctx.sessionType, label: ctx.label, legacy: p.legacy });
    await lowCreditAfter(p.clientId, ctx.coachId, p.pool, (res.charged ? 1 : 0) - (res.prevCharged ? 1 : 0));
    if (res.mark === "NO_SHOW" && (res.prevMark !== "NO_SHOW" || res.charged !== res.prevCharged)) told.push({ clientId: p.clientId, deduct: res.charged });
  }

  if (input.finalize || ctx.finalized) {
    const marks = await currentMarks(ctx);
    const missing = ctx.participants.filter((p) => !marks.has(attKey(p.kind, p.sessionId, p.clientId)) && !p.legacy).length;
    if (missing) throw badRequest("Mark everyone Present or No-Show before finalising.");
    if (ctx.booking && ctx.booking.status === "PENDING") throw badRequest("Approve the booking before finalising it.");
    await syncStatuses(ctx, "finalised");
  }

  // Tell a client when they were marked as a no-show, and what happened to their credit.
  if (told.length) {
    const when = await whenText(ctx.coachId, ctx.start);
    for (const t of told) {
      await notify([t.clientId], "no_show", {
        title: "Marked as a no-show",
        body: `You were marked as a no-show for your ${ctx.sessionType === "Group Class" ? "group session" : "session"} on ${when}. ${t.deduct ? "Your coach has used a credit for it." : "Your credit has been returned — nothing was used."}`,
        link: "/book",
      });
    }
  }
}

/** The old "mark completed / no-show" buttons: everyone unmarked is marked Present (or the owner No-Show) and the session is finalised. */
export async function applyBookingStatus(me: UserRow, bookingId: string, next: "COMPLETED" | "NO_SHOW"): Promise<void> {
  const ctx = await bookingCtx(me, bookingId);
  const marks = await currentMarks(ctx);
  const list: MarkInput[] = [];
  for (const p of ctx.participants) {
    const existing = marks.get(attKey(p.kind, p.sessionId, p.clientId));
    if (p.role === "OWNER") list.push({ clientId: p.clientId, mark: next === "COMPLETED" ? "PRESENT" : "NO_SHOW", deduct: existing?.mark === "NO_SHOW" && next === "NO_SHOW" ? existing.charged : false });
    else if (!existing) list.push({ clientId: p.clientId, mark: "PRESENT" });
  }
  await applyAttendance(me, { kind: "BOOKING", id: bookingId, marks: list, finalize: true });
}

/**
 * A client cancelled inside the notice window and the coach charges for that: one session credit is used. It is recorded as a charged
 * no-show (so it shows in the credit log and attendance and can be undone), labelled "Late cancellation".
 */
export async function chargeLateCancel(row: BookingRow): Promise<void> {
  const group = await sharedGroupFor(row.id);
  const when = await whenText(row.coachId, row.startAt);
  const pool: Pool = group ? "GROUP" : "SESSION";
  const res = await setMark({ kind: "BOOKING", sessionId: row.id, coachId: row.coachId, clientId: row.clientId, pool, mark: "NO_SHOW", deduct: true, sessionType: group ? "Group Class" : "1-on-1 PT", label: `Late cancellation · ${when}` });
  await lowCreditAfter(row.clientId, row.coachId, pool, (res.charged ? 1 : 0) - (res.prevCharged ? 1 : 0));
}

/** The coach forgives a late cancellation: the credit goes back and the mark is removed. Does nothing when nothing was charged. */
export async function waiveLateCancel(row: BookingRow): Promise<boolean> {
  const rec = (await attendanceFor("BOOKING", [row.id])).get(attKey("BOOKING", row.id, row.clientId));
  if (!rec || !rec.charged) return false;
  const when = await whenText(row.coachId, row.startAt);
  await setMark({ kind: "BOOKING", sessionId: row.id, coachId: row.coachId, clientId: row.clientId, pool: rec.pool as Pool, mark: "CLEAR", sessionType: rec.pool === "GROUP" ? "Group Class" : "1-on-1 PT", label: `Late cancellation waived · ${when}` });
  return true;
}

/** A booking is being cancelled: a credit already taken for it (marked Present early) is returned. */
export async function clearBookingMark(row: BookingRow): Promise<void> {
  const group = await sharedGroupFor(row.id);
  const legacy = row.status === "COMPLETED" ? { mark: "PRESENT" as Mark, charged: true } : row.status === "NO_SHOW" ? { mark: "NO_SHOW" as Mark, charged: true } : undefined;
  await setMark({ kind: "BOOKING", sessionId: row.id, coachId: row.coachId, clientId: row.clientId, pool: group ? "GROUP" : "SESSION", mark: "CLEAR", sessionType: group ? "Group Class" : "1-on-1 PT", label: "Cancelled session", legacy });
}
