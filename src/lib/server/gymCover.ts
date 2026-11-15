import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { openProfile } from "./accounts";
import { db } from "./db";
import { badRequest, conflict, forbidden, int, notFound, str } from "./http";
import { classConflict, insertGroup, newSeriesId, notify, whenText } from "./groups";
import { audit, type Membership } from "./gymOrg";
import { hasConflict } from "./schedule";
import { assessments, bookings, groupMembers, groupSessions, gymMembers, gymMoves, intakeForms, intakeRequests, users, type UserRow } from "./schema";

const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const nameOf = (u: UserRow) => (u.role === "CLIENT" ? safeName(u) : (u.name ?? u.username));
function safeName(u: UserRow): string {
  try {
    return openProfile(u).name || u.username;
  } catch {
    return u.username;
  }
}

async function activeMember(gymId: string, userId: string): Promise<UserRow> {
  const d = await db();
  const [mem] = await d.select().from(gymMembers).where(and(eq(gymMembers.gymId, gymId), eq(gymMembers.userId, userId), eq(gymMembers.status, "ACTIVE"))).limit(1);
  const [u] = await d.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!mem || !u || !u.active) throw badRequest("Choose a coach who is active in your gym.");
  return u;
}

/* ---------------- Cover for one session or class ---------------- */
export type CoverKind = "session" | "class";

/**
 * Hands one upcoming session or class to another coach of the gym ("cover"). The session moves to the cover coach's schedule and
 * remembers who it belonged to; choosing the original coach again undoes it. The cover coach, the original coach and the client(s)
 * are told. A cover coach already busy at that time is refused.
 */
export async function coverSession(m: Membership, actor: UserRow, kind: CoverKind, id: string, toCoachId: string): Promise<void> {
  const d = await db();
  const to = await activeMember(m.gym.id, toCoachId);
  if (kind === "session") {
    const [b] = await d.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!b) throw notFound("That session no longer exists.");
    const from = await activeMember(m.gym.id, b.coachId).catch(() => null);
    if (!from) throw forbidden("That session doesn't belong to a coach of your gym.");
    if (b.status !== "CONFIRMED" && b.status !== "PENDING") throw conflict("Only an upcoming session can be covered.");
    if (b.endAt.getTime() < Date.now()) throw conflict("That session has already happened.");
    if (to.id === b.coachId) throw conflict("They already have that session.");
    const original = b.originalCoachId ?? b.coachId;
    if (await hasConflict(to.id, b.startAt, b.endAt, b.id)) throw conflict(`${nameOf(to)} is busy at that time.`);
    if (await classConflict(to.id, b.startAt, b.endAt)) throw conflict(`${nameOf(to)} has a class at that time.`);
    const back = to.id === original;
    await d.update(bookings).set({ coachId: to.id, originalCoachId: back ? null : original, rev: b.rev + 1 }).where(eq(bookings.id, b.id));
    const when = await whenText(to.id, b.startAt);
    const [client] = await d.select().from(users).where(eq(users.id, b.clientId)).limit(1);
    await audit(m.gym.id, actor.id, back ? "cover_undone" : "cover_arranged", `${when}: ${nameOf(from)} → ${nameOf(to)}`);
    await notify([to.id], "gym_cover", { title: back ? "Session back with you" : "You're covering a session", body: back ? `${when} is back on your schedule.` : `${when} with ${client ? nameOf(client) : "a client"} is now yours to coach. You can see that client's workout plan for this session.`, link: "/schedule", about: client?.id });
    await notify([from.id], "gym_cover", { title: back ? "Session back with you" : "Your session is covered", body: back ? `${when} is back on your schedule.` : `${nameOf(to)} will coach ${when}.`, link: "/schedule" });
    if (client) await notify([client.id], "gym_cover", { title: back ? "Your coach is back" : "A different coach for one session", body: back ? `Your session ${when} is with your usual coach again.` : `${nameOf(to)} will take your session ${when}, because your coach can't make it. Same time, same place.`, link: "/home" });
    return;
  }
  const [g] = await d.select().from(groupSessions).where(eq(groupSessions.id, id)).limit(1);
  if (!g) throw notFound("That class no longer exists.");
  const from = await activeMember(m.gym.id, g.coachId).catch(() => null);
  if (!from) throw forbidden("That class doesn't belong to a coach of your gym.");
  if (g.status !== "OPEN") throw conflict("Only an upcoming class can be covered.");
  if (g.endAt.getTime() < Date.now()) throw conflict("That class has already happened.");
  if (to.id === g.coachId) throw conflict("They already have that class.");
  const original = g.originalCoachId ?? g.coachId;
  if (await hasConflict(to.id, g.startAt, g.endAt, undefined, g.id)) throw conflict(`${nameOf(to)} is busy at that time.`);
  if (await classConflict(to.id, g.startAt, g.endAt, g.id)) throw conflict(`${nameOf(to)} has a class at that time.`);
  const back = to.id === original;
  await d.update(groupSessions).set({ coachId: to.id, originalCoachId: back ? null : original, rev: g.rev + 1 }).where(eq(groupSessions.id, g.id));
  const when = await whenText(to.id, g.startAt);
  const members = await d.select({ clientId: groupMembers.clientId }).from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.role, "MEMBER"), inArray(groupMembers.status, ["CONFIRMED", "WAITLIST"])));
  await audit(m.gym.id, actor.id, back ? "cover_undone" : "cover_arranged", `class ${when}: ${nameOf(from)} → ${nameOf(to)}`);
  await notify([to.id], "gym_cover", { title: back ? "Class back with you" : "You're covering a class", body: back ? `The class ${when} is back on your schedule.` : `The class ${when} is now yours to coach. You can see the attendees' workout plan for it.`, link: "/schedule" });
  await notify([from.id], "gym_cover", { title: back ? "Class back with you" : "Your class is covered", body: back ? `The class ${when} is back on your schedule.` : `${nameOf(to)} will coach the class ${when}.`, link: "/schedule" });
  if (members.length) await notify(members.map((x) => x.clientId), "gym_cover", { title: back ? "Your class coach is back" : "A different coach for one class", body: back ? `The class ${when} is with the usual coach again.` : `${nameOf(to)} will coach the class ${when}. Same time, same place.`, link: "/home" });
}

/** The coach can't make it: cancel the session or class and tell everyone involved. */
export async function cancelAndNotify(m: Membership, actor: UserRow, kind: CoverKind, id: string, reasonRaw: unknown): Promise<void> {
  const reason = str(reasonRaw, "Reason", { optional: true, max: 200 });
  const d = await db();
  const tail = reason ? ` Reason: ${reason}.` : "";
  if (kind === "session") {
    const [b] = await d.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!b) throw notFound("That session no longer exists.");
    await activeMember(m.gym.id, b.coachId).catch(() => {
      throw forbidden("That session doesn't belong to a coach of your gym.");
    });
    if (b.status !== "CONFIRMED" && b.status !== "PENDING") throw conflict("Only an upcoming session can be cancelled.");
    await d.update(bookings).set({ status: "CANCELLED", rev: b.rev + 1 }).where(eq(bookings.id, b.id));
    const when = await whenText(b.coachId, b.startAt);
    await audit(m.gym.id, actor.id, "session_cancelled", `${when}${reason ? ` (${reason})` : ""}`);
    await notify([b.clientId], "gym_cancel", { title: "Your session was cancelled", body: `Your session ${when} was cancelled by the gym.${tail} No session credit is used.`, link: "/book" });
    await notify([b.coachId], "gym_cancel", { title: "A session was cancelled", body: `The gym cancelled your session ${when}.${tail}`, link: "/schedule" });
    return;
  }
  const [g] = await d.select().from(groupSessions).where(eq(groupSessions.id, id)).limit(1);
  if (!g) throw notFound("That class no longer exists.");
  await activeMember(m.gym.id, g.coachId).catch(() => {
    throw forbidden("That class doesn't belong to a coach of your gym.");
  });
  if (g.status !== "OPEN") throw conflict("Only an upcoming class can be cancelled.");
  await d.update(groupSessions).set({ status: "CANCELLED", rev: g.rev + 1 }).where(eq(groupSessions.id, g.id));
  const when = await whenText(g.coachId, g.startAt);
  const members = await d.select({ clientId: groupMembers.clientId }).from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.role, "MEMBER"), inArray(groupMembers.status, ["CONFIRMED", "WAITLIST"])));
  await audit(m.gym.id, actor.id, "class_cancelled", `${when}${reason ? ` (${reason})` : ""}`);
  if (members.length) await notify(members.map((x) => x.clientId), "gym_cancel", { title: "A class was cancelled", body: `The class ${when} was cancelled by the gym.${tail} No class credit is used.`, link: "/home" });
  await notify([g.coachId], "gym_cancel", { title: "A class was cancelled", body: `The gym cancelled your class ${when}.${tail}`, link: "/schedule" });
}

/* ---------------- Classes made by the gym ---------------- */
/** The gym creates a class (optionally repeating weekly) and gives it to one of its coaches, who can then run it like their own. */
export async function createClassFor(m: Membership, actor: UserRow, body: Record<string, unknown>): Promise<{ created: number; skipped: string[] }> {
  const coach = await activeMember(m.gym.id, str(body.coachId, "Coach", { max: 80 }));
  const title = str(body.title, "Class title", { max: 100 });
  const capacity = int(body.capacity, "Spots", 2, 30);
  const duration = int(body.durationMin ?? 60, "Length", 15, 300);
  const weeks = int(body.repeatWeeks ?? 1, "Weeks", 1, 26);
  const first = new Date(str(body.start, "Start time", { max: 40 }));
  if (Number.isNaN(first.getTime())) throw badRequest("Invalid start time.");
  if (first.getTime() < Date.now() - 5 * 60_000) throw badRequest("That start time has already passed.");
  const location = str(body.location, "Location", { min: 2, max: 140 });
  const notes = str(body.notes, "Notes", { optional: true, max: 500 });

  const seriesId = weeks > 1 ? newSeriesId() : undefined;
  let created = 0;
  const skipped: string[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = new Date(first.getTime() + i * 7 * 86_400_000);
    const end = new Date(start.getTime() + duration * 60_000);
    const when = await whenText(coach.id, start);
    if ((await hasConflict(coach.id, start, end)) || (await classConflict(coach.id, start, end))) {
      skipped.push(`${when}: ${nameOf(coach)} is busy then`);
      continue;
    }
    await insertGroup({ coachId: coach.id, kind: "CLASS", start, end, capacity, seriesId, details: { title, notes, gymId: null, customGym: location } });
    created++;
  }
  if (!created) throw badRequest(skipped.length ? `Couldn't create the class: ${skipped[0]}` : "Couldn't create the class.");
  await audit(m.gym.id, actor.id, "class_created", `${title} for ${nameOf(coach)}${created > 1 ? ` (${created} weeks)` : ""}`);
  if (coach.id !== actor.id) await notify([coach.id], "gym_class", { title: "The gym added a class to your schedule", body: `${title}, ${await whenText(coach.id, first)} at ${location}${created > 1 ? `, repeating for ${created} weeks` : ""}.`, link: "/schedule" });
  return { created, skipped };
}

/* ---------------- Moving a client for good ---------------- */
export interface MoveView {
  id: string;
  clientName: string;
  fromName: string;
  toName: string;
  status: string;
  createdAt: string;
}

/** The gym proposes moving a client to another coach in the gym. Nothing changes until the client agrees. */
export async function proposeMove(m: Membership, actor: UserRow, clientId: string, toCoachId: string): Promise<string> {
  const d = await db();
  const [client] = await d.select().from(users).where(and(eq(users.id, clientId), eq(users.role, "CLIENT"))).limit(1);
  if (!client || !client.coachId) throw notFound("That client isn't with a coach.");
  const from = await activeMember(m.gym.id, client.coachId).catch(() => null);
  if (!from) throw forbidden("That client isn't with a coach of your gym.");
  const to = await activeMember(m.gym.id, toCoachId);
  if (to.id === from.id) throw conflict("They are already with that coach.");
  const open = await d.select({ id: gymMoves.id }).from(gymMoves).where(and(eq(gymMoves.clientId, clientId), eq(gymMoves.status, "PENDING"))).limit(1);
  if (open.length) throw conflict("That client already has a move waiting for their answer.");
  const id = newId("gm");
  await d.insert(gymMoves).values({ id, gymId: m.gym.id, clientId, fromCoachId: from.id, toCoachId: to.id });
  await audit(m.gym.id, actor.id, "move_proposed", `${nameOf(from)} → ${nameOf(to)}`);
  await notify([clientId], "gym_move", { title: "Your coach is changing", body: `${m.gym.name} would like to move you from ${nameOf(from)} to ${nameOf(to)}. Nothing changes until you agree. Open Home to answer.`, link: "/home" });
  return id;
}

/** Moves waiting for this client's answer. */
export async function movesForClient(client: UserRow): Promise<MoveView[]> {
  const d = await db();
  const rows = await d.select().from(gymMoves).where(and(eq(gymMoves.clientId, client.id), eq(gymMoves.status, "PENDING"))).orderBy(desc(gymMoves.createdAt));
  if (!rows.length) return [];
  const us = await d.select().from(users).where(inArray(users.id, rows.flatMap((r) => [r.fromCoachId, r.toCoachId])));
  const nm = new Map(us.map((u) => [u.id, nameOf(u)]));
  return rows.map((r) => ({ id: r.id, clientName: nameOf(client), fromName: nm.get(r.fromCoachId) ?? "your coach", toName: nm.get(r.toCoachId) ?? "a new coach", status: r.status, createdAt: r.createdAt.toISOString() }));
}

/** Moves of this gym (waiting first), for the gym's own screen. Coach names only. */
export async function movesForGym(gymId: string): Promise<MoveView[]> {
  const d = await db();
  const rows = await d.select().from(gymMoves).where(eq(gymMoves.gymId, gymId)).orderBy(desc(gymMoves.createdAt)).limit(30);
  if (!rows.length) return [];
  const us = await d.select().from(users).where(inArray(users.id, [...new Set(rows.flatMap((r) => [r.fromCoachId, r.toCoachId, r.clientId]))]));
  const nm = new Map(us.map((u) => [u.id, nameOf(u)]));
  const first = (id: string) => (nm.get(id) ?? "Client").split(/\s+/)[0];
  return rows.map((r) => ({ id: r.id, clientName: first(r.clientId), fromName: nm.get(r.fromCoachId) ?? "—", toName: nm.get(r.toCoachId) ?? "—", status: r.status, createdAt: r.createdAt.toISOString() }));
}

/** The client's answer. Agreeing makes the new coach theirs and takes their upcoming sessions along (a time the new coach can't do stays with the old coach). */
export async function respondToMove(client: UserRow, moveId: string, accept: boolean): Promise<{ movedSessions: number; keptSessions: number }> {
  const d = await db();
  const [mv] = await d.select().from(gymMoves).where(and(eq(gymMoves.id, moveId), eq(gymMoves.clientId, client.id), eq(gymMoves.status, "PENDING"))).limit(1);
  if (!mv) throw notFound("That request is no longer waiting.");
  if (!accept) {
    await d.update(gymMoves).set({ status: "DECLINED", decidedAt: new Date() }).where(eq(gymMoves.id, mv.id));
    await audit(mv.gymId, client.id, "move_declined", "");
    await notify([mv.fromCoachId], "gym_move", { title: "A client stayed with you", body: `${safeName(client)} chose to stay with you.`, link: "/clients" }, { email: false });
    return { movedSessions: 0, keptSessions: 0 };
  }
  if (client.coachId !== mv.fromCoachId) {
    await d.update(gymMoves).set({ status: "CANCELLED", decidedAt: new Date() }).where(eq(gymMoves.id, mv.id));
    throw conflict("Your coach changed in the meantime, so this request no longer applies.");
  }
  const [to] = await d.select().from(users).where(eq(users.id, mv.toCoachId)).limit(1);
  const [from] = await d.select().from(users).where(eq(users.id, mv.fromCoachId)).limit(1);
  if (!to || !to.active) throw conflict("That coach isn't available any more.");
  await d.update(users).set({ coachId: to.id, updatedAt: new Date() }).where(eq(users.id, client.id));
  // Their forms and assessments go with them to the new coach (and only the new coach sees them).
  await d.update(intakeForms).set({ coachId: to.id }).where(eq(intakeForms.clientId, client.id));
  await d.update(intakeRequests).set({ coachId: to.id }).where(eq(intakeRequests.clientId, client.id));
  await d.update(assessments).set({ coachId: to.id }).where(eq(assessments.clientId, client.id));
  const future = await d.select().from(bookings).where(and(eq(bookings.clientId, client.id), eq(bookings.coachId, from.id), gt(bookings.startAt, new Date()), inArray(bookings.status, ["CONFIRMED", "PENDING"])));
  let moved = 0, kept = 0;
  for (const b of future) {
    if ((await hasConflict(to.id, b.startAt, b.endAt, b.id)) || (await classConflict(to.id, b.startAt, b.endAt))) {
      kept++;
      continue;
    }
    await d.update(bookings).set({ coachId: to.id, rev: b.rev + 1 }).where(eq(bookings.id, b.id));
    moved++;
  }
  await d.update(gymMoves).set({ status: "ACCEPTED", decidedAt: new Date() }).where(eq(gymMoves.id, mv.id));
  await audit(mv.gymId, client.id, "move_accepted", `${nameOf(from)} → ${nameOf(to)}`);
  await notify([to.id], "gym_move", { title: "A new client", body: `${safeName(client)} is now your client (moved by the gym).${moved ? ` ${moved} upcoming session${moved === 1 ? "" : "s"} came with them.` : ""}`, link: `/clients/${client.id}` });
  await notify([from.id], "gym_move", { title: "A client moved to another coach", body: `${safeName(client)} moved to ${nameOf(to)}.${kept ? ` ${kept} upcoming session${kept === 1 ? " stays" : "s stay"} with you because of clashes; sort those out with the gym.` : ""}`, link: "/clients" });
  return { movedSessions: moved, keptSessions: kept };
}

/* ---------------- What a cover coach may open ---------------- */
/** Clients of sessions and classes this coach is covering that are close (a day or two either side), so they can prepare and run them. */
export async function coverClientIds(coachId: string): Promise<string[]> {
  const d = await db();
  const from = new Date(Date.now() - 12 * 3_600_000);
  const to = new Date(Date.now() + 48 * 3_600_000);
  const bs = await d
    .select({ clientId: bookings.clientId })
    .from(bookings)
    .where(and(eq(bookings.coachId, coachId), isNotNull(bookings.originalCoachId), gte(bookings.endAt, from), lt(bookings.startAt, to), ne(bookings.status, "CANCELLED")));
  const gs = await d
    .select({ id: groupSessions.id })
    .from(groupSessions)
    .where(and(eq(groupSessions.coachId, coachId), isNotNull(groupSessions.originalCoachId), gte(groupSessions.endAt, from), lt(groupSessions.startAt, to), ne(groupSessions.status, "CANCELLED")));
  const ms = gs.length ? await d.select({ clientId: groupMembers.clientId }).from(groupMembers).where(and(inArray(groupMembers.groupId, gs.map((g) => g.id)), eq(groupMembers.role, "MEMBER"), inArray(groupMembers.status, ["CONFIRMED", "ATTENDED", "ABSENT"]))) : [];
  return [...new Set([...bs.map((b) => b.clientId), ...ms.map((x) => x.clientId)])];
}

