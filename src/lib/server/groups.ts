import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { SEED_EXERCISES } from "@/data/exercises";
import { isHomeLocation } from "@/lib/gyms";
import { findPrevious } from "@/lib/stats";
import type { AppNotification, Exercise, GroupMember, GroupRequest, GroupSession, MemberStatus, PlaceInfo, TemplateExercise, Workout, WorkoutSet } from "@/lib/types";
import { loadClientFor, openProfile, usersByIds } from "./accounts";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { escapeHtml, layout, sendMail } from "./mail";
import { attendance, bookings, groupMembers, groupRequests, groupSessions, notifications, templates, users, workouts, type AttendanceRow, type GroupMemberRow, type GroupRequestRow, type GroupRow, type UserRow } from "./schema";
import { attendanceFor, attendanceInfo, attKey, logCredit, setMark } from "./credits";
import { rulesFor, toBooking } from "./schedule";
import { customExercisesFor, insertWorkoutIfAbsent, parseTemplateExercise, recentDoneWorkouts } from "./training";

/*
 * Group classes and shared sessions.
 *  - A CLASS is scheduled by the coach and booked by clients straight away until it is full (then they join a waitlist).
 *  - A SHARED session is a client's own booking opened to partners. A newcomer is added only when the coach AND every
 *    current attendee approve.
 *  - A group credit is only used up when the class is completed, so a cancellation never costs one (for now).
 *  - Clients are only ever told how many spots are left, never who is in a class.
 */

const aadG = (id: string) => `group:${id}`;
const aadN = (id: string) => `notification:${id}`;

export const GROUP_MAX = 30;
export const SHARED_DEFAULT = 4;
const REQUEST_HOURS = 24;
const CLOSE_BEFORE_MIN = 120;

interface GroupDetails {
  title: string;
  notes: string;
  gymId?: string | null;
  customGym?: string;
  place?: PlaceInfo;
  templateId?: string;
  templateName?: string;
  /** The workout pushed to attendees (a snapshot, so later template edits do not change a class in progress). */
  plan?: TemplateExercise[];
  workoutTitle?: string;
}

const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

export function openGroup(row: GroupRow): GroupDetails {
  try {
    return decryptJson<GroupDetails>(row.detailsEnc, aadG(row.id));
  } catch (e) {
    console.error("Could not decrypt group", row.id, e);
    return { title: "Group session", notes: "" };
  }
}
export const sealGroup = (id: string, d: GroupDetails) => encryptJson(d, aadG(id));

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sat 24 Oct, 10:00 AM" in the coach's local time (so notifications don't show UTC). */
export async function whenText(coachId: string, d: Date): Promise<string> {
  const off = (await rulesFor(coachId)).utcOffsetMin;
  const l = new Date(d.getTime() + off * 60000);
  const h = l.getUTCHours();
  return `${DAYS[l.getUTCDay()]} ${l.getUTCDate()} ${MONTHS[l.getUTCMonth()]}, ${h % 12 || 12}:${String(l.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/* ---------------- Notifications ---------------- */
interface NoteBody {
  title: string;
  body: string;
  link?: string;
}

async function firstNameOf(row: UserRow): Promise<string> {
  const full = row.role === "CLIENT" ? openProfile(row).name : (row.name ?? row.username);
  return full.trim().split(/\s+/)[0] || "A client";
}
async function fullNameOf(row: UserRow): Promise<string> {
  return row.role === "CLIENT" ? openProfile(row).name : (row.name ?? row.username);
}
function emailOf(row: UserRow): string {
  try {
    return row.role === "CLIENT" ? openProfile(row).email : (row.email ?? "");
  } catch {
    return "";
  }
}

/** Saves an in-app notification (and, when the person has an address, a short email). Never throws. */
export async function notify(userIds: string[], kind: string, n: NoteBody, opts: { email?: boolean } = { email: true }): Promise<void> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  try {
    const d = await db();
    const rows = await usersByIds(ids);
    for (const u of rows) {
      const id = newId("n");
      await d.insert(notifications).values({ id, userId: u.id, kind, bodyEnc: encryptJson(n, aadN(id)) });
      const to = opts.email === false ? "" : emailOf(u);
      if (to) {
        void sendMail({
          to,
          subject: `CoachFlow — ${n.title}`,
          text: `${n.title}\n\n${n.body}\n\nOpen CoachFlow to respond.`,
          html: layout(n.title, `<p style="margin:0;line-height:1.5;">${escapeHtml(n.body)}</p>`),
        }).catch(() => undefined);
      }
    }
  } catch (e) {
    console.error("notify failed", e);
  }
}

export async function loadNotifications(userId: string): Promise<AppNotification[]> {
  const d = await db();
  const rows = await d.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(40);
  const out: AppNotification[] = [];
  for (const r of rows) {
    try {
      const b = decryptJson<NoteBody>(r.bodyEnc, aadN(r.id));
      out.push({ id: r.id, kind: r.kind, title: b.title, body: b.body, link: b.link, createdAt: r.createdAt.toISOString(), read: !!r.readAt });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

export async function markNotificationsRead(userId: string, ids: string[] | "all"): Promise<void> {
  const d = await db();
  const where = ids === "all" ? and(eq(notifications.userId, userId), sql`${notifications.readAt} is null`) : and(eq(notifications.userId, userId), inArray(notifications.id, ids.slice(0, 100)), sql`${notifications.readAt} is null`);
  await d.update(notifications).set({ readAt: new Date() }).where(where);
}

/* ---------------- Credits ---------------- */
/** Group credits promised to classes that have not been completed yet. */
export async function reservedGroupCount(clientId: string): Promise<number> {
  const d = await db();
  const rows = await d
    .select({ gid: groupMembers.groupId, role: groupMembers.role, bookingId: groupSessions.bookingId })
    .from(groupMembers)
    .innerJoin(groupSessions, eq(groupSessions.id, groupMembers.groupId))
    .where(and(eq(groupMembers.clientId, clientId), eq(groupMembers.status, "CONFIRMED"), eq(groupSessions.status, "OPEN")));
  if (!rows.length) return 0;
  // A person who already has an attendance mark has settled their credit, so it is no longer "reserved".
  const marked = new Set((await d.select({ k: attendance.kind, s: attendance.sessionId }).from(attendance).where(eq(attendance.clientId, clientId))).map((r) => `${r.k}:${r.s}`));
  return rows.filter((r) => !marked.has(r.role === "OWNER" ? `BOOKING:${r.bookingId}` : `GROUP:${r.gid}`)).length;
}

/** Credit log line for a group credit being reserved (the balance itself only changes when attendance is marked). */
export async function logReserved(clientId: string, coachId: string, label: string): Promise<void> {
  await logCredit({ clientId, coachId, pool: "GROUP", kind: "RESERVED", delta: 0, sessionType: "Group Class", label });
}

export async function groupCreditsAvailable(client: UserRow): Promise<number> {
  return (openProfile(client).groupClassCredits ?? 0) - (await reservedGroupCount(client.id));
}

/* ---------------- Reading ---------------- */
async function membersOf(groupIds: string[]): Promise<Map<string, GroupMemberRow[]>> {
  const out = new Map<string, GroupMemberRow[]>();
  if (!groupIds.length) return out;
  const d = await db();
  const rows = await d.select().from(groupMembers).where(inArray(groupMembers.groupId, groupIds)).orderBy(asc(groupMembers.joinedAt));
  for (const r of rows) {
    const list = out.get(r.groupId) ?? [];
    list.push(r);
    out.set(r.groupId, list);
  }
  return out;
}

function shape(row: GroupRow, members: GroupMemberRow[], me: UserRow, templateNames: Map<string, string>, att: Map<string, AttendanceRow>): GroupSession {
  const markOf = (m: GroupMemberRow) => attendanceInfo(att.get(m.role === "OWNER" && row.bookingId ? attKey("BOOKING", row.bookingId, m.clientId) : attKey("GROUP", row.id, m.clientId)));
  const det = openGroup(row);
  const confirmed = members.filter((m) => m.status === "CONFIRMED" || m.status === "ATTENDED").length;
  const waiting = members.filter((m) => m.status === "WAITLIST");
  const isClient = me.role === "CLIENT";
  const own = isClient ? members.find((m) => m.clientId === me.id) : undefined;
  const g: GroupSession = {
    id: row.id,
    kind: row.kind as GroupSession["kind"],
    title: det.title,
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
    capacity: row.capacity,
    status: row.status as GroupSession["status"],
    gymId: det.gymId ?? null,
    customGym: det.customGym || undefined,
    place: det.place,
    notes: det.notes ?? "",
    templateId: det.templateId,
    templateName: det.templateId ? (templateNames.get(det.templateId) ?? det.templateName) : undefined,
    bookingId: !isClient || own?.role === "OWNER" ? (row.bookingId ?? undefined) : undefined,
    seriesId: row.seriesId ?? undefined,
    confirmed,
    spotsLeft: Math.max(0, row.capacity - confirmed),
    waitlist: waiting.length,
    workoutStartedAt: row.workoutStartedAt?.toISOString(),
    workoutTitle: det.workoutTitle,
  };
  if (own && (own.status === "CONFIRMED" || own.status === "ATTENDED" || own.status === "ABSENT")) g.mine = { status: "CONFIRMED", role: own.role as "OWNER" | "MEMBER", attendance: markOf(own) };
  else if (own?.status === "WAITLIST") g.mine = { status: "WAITLIST", position: waiting.findIndex((m) => m.clientId === me.id) + 1, role: "MEMBER" };
  if (!isClient) {
    g.members = members.map((m) => ({
      clientId: m.clientId,
      status: m.status as MemberStatus,
      role: m.role as GroupMember["role"],
      joinedAt: m.joinedAt.toISOString(),
      position: m.status === "WAITLIST" ? waiting.findIndex((w) => w.clientId === m.clientId) + 1 : undefined,
      attendance: markOf(m),
    }));
  }
  return g;
}

function parseApprovals(s: string): Record<string, string> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Who has to approve a join request right now: the coach and everyone currently confirmed in the session. */
async function approversFor(group: GroupRow): Promise<string[]> {
  const d = await db();
  const rows = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.status, "CONFIRMED")));
  return [group.coachId, ...rows.map((r) => r.clientId)];
}

export interface GroupsPayload {
  groups: GroupSession[];
  requests: GroupRequest[];
  notifications: AppNotification[];
  unread: number;
}

/** Everything the class screens need for `me`. Also settles requests that have run out of time. */
export async function loadGroups(me: UserRow): Promise<GroupsPayload> {
  const coachId = me.role === "CLIENT" ? me.coachId : me.id;
  const empty: GroupsPayload = { groups: [], requests: [], notifications: [], unread: 0 };
  if (!coachId) return empty;
  const d = await db();
  const since = new Date(Date.now() - 120 * 86400000);
  // The coach's templates only supply class names, so they load alongside the sessions (independent reads run together).
  const [, rows, tRows] = await Promise.all([
    expireRequests(coachId),
    d.select().from(groupSessions).where(and(eq(groupSessions.coachId, coachId), gt(groupSessions.endAt, since))),
    d.select().from(templates).where(eq(templates.ownerId, coachId)),
  ]);
  const [members, attGroup, attBooking] = await Promise.all([
    membersOf(rows.map((r) => r.id)),
    attendanceFor("GROUP", rows.map((r) => r.id)),
    attendanceFor("BOOKING", rows.filter((r) => r.bookingId).map((r) => r.bookingId as string)),
  ]);
  const att = new Map([...attGroup, ...attBooking]);

  const templateNames = new Map<string, string>();
  for (const t of tRows) {
    try {
      templateNames.set(t.id, decryptJson<{ name: string }>(t.dataEnc, `template:${t.id}`).name);
    } catch {
      /* ignore */
    }
  }

  const now = Date.now();
  const groups: GroupSession[] = [];
  for (const r of rows) {
    const list = members.get(r.id) ?? [];
    if (me.role === "CLIENT") {
      const own = list.find((m) => m.clientId === me.id);
      const mine = !!own && own.status !== "CANCELLED";
      const open = r.status === "OPEN" && r.endAt.getTime() > now;
      // A shared session is only offered to others while it is upcoming; a coach class is public to the coach's clients.
      if (!mine && !open) continue;
      if (!mine && r.status === "CANCELLED") continue;
    }
    groups.push(shape(r, list, me, templateNames, att));
  }

  // Join requests: the ones I made, plus (coach / current attendees) the pending ones I must answer.
  const reqRows = rows.length ? await d.select().from(groupRequests).where(and(inArray(groupRequests.groupId, rows.map((r) => r.id)), gt(groupRequests.createdAt, since))) : [];
  const byGroup = new Map(rows.map((r) => [r.id, r]));
  const requests: GroupRequest[] = [];
  const requesterRows = new Map((await usersByIds([...new Set(reqRows.map((r) => r.clientId))])).map((u) => [u.id, u]));
  for (const rq of reqRows) {
    const g = byGroup.get(rq.groupId);
    if (!g) continue;
    const mineReq = rq.clientId === me.id;
    let needsMe = false;
    let required = 0;
    let approved = 0;
    const approvals = parseApprovals(rq.approvals);
    if (rq.status === "PENDING") {
      const need = await approversFor(g);
      required = need.length;
      approved = need.filter((id) => approvals[id] === "APPROVED").length;
      needsMe = need.includes(me.id) && !approvals[me.id];
    }
    const isCoach = me.role !== "CLIENT" && g.coachId === me.id;
    const approverNow = rq.status === "PENDING" && (await approversFor(g)).includes(me.id);
    if (!mineReq && !isCoach && !approverNow) continue;
    if (!mineReq && rq.status !== "PENDING") continue;
    const requester = requesterRows.get(rq.clientId);
    requests.push({
      id: rq.id,
      groupId: rq.groupId,
      status: rq.status as GroupRequest["status"],
      createdAt: rq.createdAt.toISOString(),
      expiresAt: rq.expiresAt.toISOString(),
      requesterName: mineReq || !requester ? "" : isCoach ? await fullNameOf(requester) : await firstNameOf(requester),
      mine: mineReq,
      needsMe,
      approved,
      required,
    });
  }
  for (const g of groups) {
    const mineReq = requests.find((x) => x.groupId === g.id && x.mine && x.status === "PENDING");
    if (mineReq) g.myRequest = mineReq.id;
  }

  const notes = await loadNotifications(me.id);
  return { groups, requests, notifications: notes, unread: notes.filter((n) => !n.read).length };
}

/* ---------------- Waitlist ---------------- */
async function confirmedCount(groupId: string): Promise<number> {
  const d = await db();
  const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.status, ["CONFIRMED", "ATTENDED"])));
  return r?.n ?? 0;
}

/** Fills free spots from the waitlist in order; someone without a group credit is skipped (and told). */
export async function promoteWaitlist(group: GroupRow): Promise<void> {
  if (group.status !== "OPEN" || group.endAt.getTime() <= Date.now()) return;
  const d = await db();
  for (;;) {
    if ((await confirmedCount(group.id)) >= group.capacity) return;
    const waiting = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.status, "WAITLIST"))).orderBy(asc(groupMembers.joinedAt));
    if (!waiting.length) return;
    let promoted = false;
    for (const m of waiting) {
      const [cl] = await d.select().from(users).where(eq(users.id, m.clientId)).limit(1);
      if (!cl) {
        await d.delete(groupMembers).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.clientId, m.clientId)));
        continue;
      }
      const det = openGroup(group);
      if ((await groupCreditsAvailable(cl)) < 1) {
        await notify([cl.id], "waitlist_skipped", { title: "A spot opened up", body: `A spot opened in “${det.title}” but you have no group class credits left, so it went to the next person. Ask your coach for more credits to rejoin the waitlist.`, link: `/classes/${group.id}` });
        await d.update(groupMembers).set({ status: "CANCELLED" }).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.clientId, m.clientId)));
        continue;
      }
      await d.update(groupMembers).set({ status: "CONFIRMED" }).where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.clientId, m.clientId)));
      await notify([cl.id], "waitlist_promoted", { title: "You're in!", body: `A spot opened up in “${det.title}” and you've been moved off the waitlist. Your spot is confirmed.`, link: `/classes/${group.id}` });
      await logReserved(cl.id, group.coachId, det.title);
      await ensureWorkoutFor(group, cl.id);
      promoted = true;
      break;
    }
    if (!promoted) return;
  }
}

/* ---------------- Group workout ---------------- */
export const groupWorkoutId = (groupId: string, clientId: string) => `gw_${groupId}_${clientId}`;

async function exerciseMapFor(coachId: string): Promise<Map<string, Exercise>> {
  const d = await db();
  const [coach] = await d.select().from(users).where(eq(users.id, coachId)).limit(1);
  const custom = coach ? await customExercisesFor(coach) : [];
  return new Map<string, Exercise>([...SEED_EXERCISES, ...custom].map((e) => [e.id, e]));
}

/** Builds one attendee's copy of the class workout, pre-filled from their own previous sets. */
async function buildWorkout(group: GroupRow, det: GroupDetails, clientId: string, exMap: Map<string, Exercise>): Promise<Workout> {
  const now = new Date();
  const history = await recentDoneWorkouts(clientId);
  const w: Workout = {
    id: groupWorkoutId(group.id, clientId),
    clientId,
    title: det.workoutTitle || det.title,
    startedAt: now.toISOString(),
    liveStartedAt: now.toISOString(),
    durationSec: 0,
    status: "ACTIVE",
    gymId: det.gymId ?? null,
    notes: "",
    loggedBy: "CLIENT",
    loggedById: clientId,
    groupId: group.id,
    ...(det.templateId ? { templateId: det.templateId } : {}),
    exercises: [],
  };
  w.exercises = (det.plan ?? []).map((te) => {
    const ex = exMap.get(te.exerciseId);
    const prev = findPrevious(history, w, te.exerciseId);
    const prevSets = (prev?.sets ?? []).filter((s) => s.type !== "W" && s.done);
    const count = ex?.type === "DURATION_DISTANCE" ? 1 : Math.max(1, te.sets || 1);
    const sets: WorkoutSet[] = Array.from({ length: count }, (_, i) => {
      const p = prevSets[i] ?? prevSets[prevSets.length - 1];
      const s: WorkoutSet = { id: newId("s"), type: "N", done: false };
      switch (ex?.type) {
        case "BODYWEIGHT_REPS": {
          const reps = p?.reps ?? (te.repMax || te.repMin || undefined);
          if (reps) s.reps = reps;
          break;
        }
        case "DURATION_ONLY": {
          const t = p?.durationSec ?? te.durationSec;
          if (t) s.durationSec = t;
          break;
        }
        case "DURATION_DISTANCE": {
          const t = p?.durationSec ?? te.durationSec;
          const km = p?.distanceKm ?? te.distanceKm;
          if (t) s.durationSec = t;
          if (km) s.distanceKm = km;
          break;
        }
        default: {
          const wt = p?.weight ?? te.weight;
          const reps = p?.reps ?? (te.repMax || te.repMin || undefined);
          if (wt) s.weight = wt;
          if (reps) s.reps = reps;
        }
      }
      return s;
    });
    return { id: newId("we"), exerciseId: te.exerciseId, ...(te.notes ? { notes: te.notes } : {}), sets };
  });
  return w;
}

/** Gives one attendee their copy of the workout if the coach has already pushed it (late joiners, promoted waitlisters). */
export async function ensureWorkoutFor(group: GroupRow, clientId: string): Promise<void> {
  if (!group.workoutStartedAt || group.status !== "OPEN") return;
  try {
    const det = openGroup(group);
    const w = await buildWorkout(group, det, clientId, await exerciseMapFor(group.coachId));
    if (await insertWorkoutIfAbsent(w)) await notify([clientId], "group_workout", { title: "Group workout started", body: `“${det.title}” is under way — your workout is ready on your Workout tab.`, link: `/workout/${w.id}` }, { email: false });
  } catch (e) {
    console.error("could not hand out the group workout", e);
  }
}

/* ---------------- Requests ---------------- */
export async function expireRequests(coachId: string): Promise<void> {
  const d = await db();
  const groupIds = (await d.select({ id: groupSessions.id }).from(groupSessions).where(eq(groupSessions.coachId, coachId))).map((g) => g.id);
  if (!groupIds.length) return;
  const stale = await d.select().from(groupRequests).where(and(inArray(groupRequests.groupId, groupIds), eq(groupRequests.status, "PENDING"), lt(groupRequests.expiresAt, new Date())));
  for (const rq of stale) {
    const [u] = await d.update(groupRequests).set({ status: "EXPIRED" }).where(and(eq(groupRequests.id, rq.id), eq(groupRequests.status, "PENDING"))).returning();
    if (u) await notify([rq.clientId], "request_expired", { title: "Join request expired", body: "Nobody answered your request to join the shared session in time, so it was closed. You can ask again if there's still room.", link: "/book" }, { email: false });
  }
}

/** Is a join request now fully answered? Adds the person, or closes it. */
export async function settleRequest(requestId: string): Promise<GroupRequestRow | null> {
  const d = await db();
  const [rq] = await d.select().from(groupRequests).where(eq(groupRequests.id, requestId)).limit(1);
  if (!rq || rq.status !== "PENDING") return rq ?? null;
  const [g] = await d.select().from(groupSessions).where(eq(groupSessions.id, rq.groupId)).limit(1);
  const [joiner] = await d.select().from(users).where(eq(users.id, rq.clientId)).limit(1);
  const close = async (status: "DECLINED" | "APPROVED" | "CANCELLED", title: string, body: string) => {
    const [u] = await d.update(groupRequests).set({ status }).where(and(eq(groupRequests.id, rq.id), eq(groupRequests.status, "PENDING"))).returning();
    if (u && title) await notify([rq.clientId], status === "APPROVED" ? "request_approved" : "request_declined", { title, body, link: g ? `/classes/${g.id}` : "/book" });
    return u ?? rq;
  };
  if (!g || !joiner || g.status !== "OPEN" || g.startAt.getTime() < Date.now()) return close("CANCELLED", "Join request closed", "That shared session is no longer available.");
  const approvals = parseApprovals(rq.approvals);
  if (Object.values(approvals).includes("DECLINED")) return close("DECLINED", "Request not approved", "Your request to join the shared session wasn't approved this time. Your credit is untouched.");
  const need = await approversFor(g);
  if (!need.every((id) => approvals[id] === "APPROVED")) return rq;
  // Everyone said yes: add the newcomer if there is still room and they still have a credit.
  if ((await confirmedCount(g.id)) >= g.capacity) return close("DECLINED", "Session is full", "The shared session filled up before your request was approved.");
  if ((await groupCreditsAvailable(joiner)) < 1) return close("DECLINED", "No group credits", "You have no group class credits left, so you couldn't be added. Ask your coach for more.");
  await d
    .insert(groupMembers)
    .values({ groupId: g.id, clientId: joiner.id, status: "CONFIRMED", role: "MEMBER" })
    .onConflictDoUpdate({ target: [groupMembers.groupId, groupMembers.clientId], set: { status: "CONFIRMED", role: "MEMBER", joinedAt: new Date() } });
  const done = await close("APPROVED", "You're in!", `Your request was approved — you're now part of the shared session on ${await whenText(g.coachId, g.startAt)}. 1 group class credit will be used when it's completed.`);
  await logReserved(joiner.id, g.coachId, "Partner session");
  await ensureWorkoutFor(g, joiner.id);
  return done;
}

/* ---------------- Mutations ---------------- */
export async function requireGroup(id: string): Promise<GroupRow> {
  const d = await db();
  const [g] = await d.select().from(groupSessions).where(eq(groupSessions.id, id)).limit(1);
  if (!g) throw notFound("That class doesn't exist.");
  return g;
}

export function assertCoach(me: UserRow, g: GroupRow) {
  if (me.role === "CLIENT" || g.coachId !== me.id) throw forbidden();
}
export function assertMyCoach(me: UserRow, g: GroupRow) {
  if (me.role !== "CLIENT" || me.coachId !== g.coachId) throw forbidden();
}

export interface NewGroupInput {
  coachId: string;
  kind: "CLASS" | "SHARED";
  start: Date;
  end: Date;
  capacity: number;
  details: GroupDetails;
  bookingId?: string;
  seriesId?: string;
  ownerId?: string;
}

export async function insertGroup(i: NewGroupInput): Promise<GroupRow> {
  const d = await db();
  const id = newId("g");
  const [row] = await d
    .insert(groupSessions)
    .values({ id, coachId: i.coachId, kind: i.kind, bookingId: i.bookingId ?? null, startAt: i.start, endAt: i.end, capacity: i.capacity, seriesId: i.seriesId ?? null, detailsEnc: sealGroup(id, i.details) })
    .returning();
  if (i.ownerId) await d.insert(groupMembers).values({ groupId: id, clientId: i.ownerId, status: "CONFIRMED", role: "OWNER" });
  return row;
}

export const newSeriesId = () => newId("gs");

/** Another group (coach class) overlapping this time? Used so a class blocks 1-on-1 slots and other classes. */
export async function classConflict(coachId: string, start: Date, end: Date, ignoreId?: string): Promise<boolean> {
  const d = await db();
  const rows = await d
    .select({ id: groupSessions.id })
    .from(groupSessions)
    .where(and(eq(groupSessions.coachId, coachId), eq(groupSessions.kind, "CLASS"), ne(groupSessions.status, "CANCELLED"), lt(groupSessions.startAt, end), gt(groupSessions.endAt, start)));
  return rows.some((r) => r.id !== ignoreId);
}

/** A client takes a spot (or joins the waitlist) in a coach class. */
export async function bookSpot(me: UserRow, g: GroupRow): Promise<"CONFIRMED" | "WAITLIST"> {
  assertMyCoach(me, g);
  if (g.kind !== "CLASS") throw badRequest("Join a shared session by sending a request.");
  if (g.status !== "OPEN") throw badRequest("This class is no longer open.");
  if (g.startAt.getTime() <= Date.now()) throw badRequest("This class has already started.");
  const d = await db();
  const [own] = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.clientId, me.id))).limit(1);
  if (own && (own.status === "CONFIRMED" || own.status === "WAITLIST")) throw conflict("You already have a place in this class.");
  const full = (await confirmedCount(g.id)) >= g.capacity;
  if (!full && (await groupCreditsAvailable(me)) < 1) throw badRequest("You have no group class credits left. Ask your coach to add some.");
  const status: "CONFIRMED" | "WAITLIST" = full ? "WAITLIST" : "CONFIRMED";
  await d
    .insert(groupMembers)
    .values({ groupId: g.id, clientId: me.id, status, role: "MEMBER" })
    .onConflictDoUpdate({ target: [groupMembers.groupId, groupMembers.clientId], set: { status, role: "MEMBER", joinedAt: new Date() } });
  if (status === "CONFIRMED" && (await confirmedCount(g.id)) > g.capacity) {
    // Two people took the last spot at the same moment: the later one goes to the waitlist.
    const rows = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.status, "CONFIRMED"))).orderBy(asc(groupMembers.joinedAt), asc(groupMembers.clientId));
    const rank = rows.findIndex((r) => r.clientId === me.id);
    if (rank >= g.capacity) {
      await d.update(groupMembers).set({ status: "WAITLIST" }).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.clientId, me.id)));
      return "WAITLIST";
    }
  }
  if (status === "CONFIRMED") {
    await logReserved(me.id, g.coachId, openGroup(g).title);
    await ensureWorkoutFor(g, me.id);
  }
  return status;
}

/** Leaves a class or the waitlist. Never costs a credit. */
export async function leaveGroup(g: GroupRow, clientId: string): Promise<void> {
  const d = await db();
  const [m] = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.clientId, clientId))).limit(1);
  if (!m || (m.status !== "CONFIRMED" && m.status !== "WAITLIST")) throw badRequest("They aren't in this class.");
  if (m.role === "OWNER") throw badRequest("Cancel the session from your bookings instead.");
  await d.update(groupMembers).set({ status: "CANCELLED" }).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.clientId, clientId)));
  // A credit already taken for this class (marked Present early) goes back.
  await setMark({ kind: "GROUP", sessionId: g.id, coachId: g.coachId, clientId, pool: "GROUP", mark: "CLEAR", sessionType: "Group Class", label: openGroup(g).title });
  // Their (not yet started) workout copy goes with them.
  await removeUnstartedWorkout(g, clientId);
  const wasConfirmed = m.status === "CONFIRMED";
  if (wasConfirmed && g.kind === "CLASS") await promoteWaitlist(g);
  // A shared session just lost an approver: pending requests may now be fully approved.
  if (wasConfirmed && g.kind === "SHARED") {
    const pending = await d.select().from(groupRequests).where(and(eq(groupRequests.groupId, g.id), eq(groupRequests.status, "PENDING")));
    for (const rq of pending) await settleRequest(rq.id);
  }
}

async function removeUnstartedWorkout(g: GroupRow, clientId: string): Promise<void> {
  const d = await db();
  await d.delete(workouts).where(and(eq(workouts.id, groupWorkoutId(g.id, clientId)), eq(workouts.status, "ACTIVE")));
}

export async function cancelGroup(g: GroupRow, reason: string): Promise<void> {
  const d = await db();
  const det = openGroup(g);
  const members = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), inArray(groupMembers.status, ["CONFIRMED", "WAITLIST"])));
  await d.update(groupSessions).set({ status: "CANCELLED", rev: g.rev + 1 }).where(eq(groupSessions.id, g.id));
  await d.update(groupRequests).set({ status: "CANCELLED" }).where(and(eq(groupRequests.groupId, g.id), eq(groupRequests.status, "PENDING")));
  for (const m of members) {
    await removeUnstartedWorkout(g, m.clientId);
    await setMark({ kind: "GROUP", sessionId: g.id, coachId: g.coachId, clientId: m.clientId, pool: "GROUP", mark: "CLEAR", sessionType: "Group Class", label: det.title });
  }
  await notify(members.filter((m) => m.role !== "OWNER").map((m) => m.clientId), "group_cancelled", { title: "Class cancelled", body: `“${det.title}” on ${await whenText(g.coachId, g.startAt)} was cancelled${reason ? ` — ${reason}` : ""}. No group credit was used.`, link: "/book" });
}

/** The coach pushes the shared workout to every confirmed attendee. */
export async function startGroupWorkout(me: UserRow, g: GroupRow, input: { templateId?: string; plan?: unknown; title?: string }): Promise<number> {
  assertCoach(me, g);
  if (g.status !== "OPEN") throw badRequest("This class is closed.");
  if (g.workoutStartedAt) throw conflict("The workout has already been pushed to this class.");
  const d = await db();
  const det = openGroup(g);
  let plan: TemplateExercise[] = [];
  let templateId = det.templateId;
  let templateName = det.templateName;
  if (Array.isArray(input.plan) && input.plan.length) {
    if (input.plan.length > 40) throw badRequest("That's too many exercises.");
    plan = input.plan.map((x) => parseTemplateExercise(x));
    templateId = undefined;
    templateName = undefined;
  } else {
    const tid = input.templateId || det.templateId;
    if (!tid) throw badRequest("Choose a routine or build the workout first.");
    const [t] = await d.select().from(templates).where(and(eq(templates.id, tid), eq(templates.ownerId, me.id))).limit(1);
    if (!t) throw badRequest("That routine wasn't found.");
    const tpl = decryptJson<{ name: string; exercises: TemplateExercise[] }>(t.dataEnc, `template:${t.id}`);
    plan = tpl.exercises;
    templateId = t.id;
    templateName = tpl.name;
  }
  if (!plan.length) throw badRequest("That workout has no exercises.");
  const workoutTitle = (input.title ?? "").trim().slice(0, 120) || det.title;
  const [claimed] = await d
    .update(groupSessions)
    .set({ workoutStartedAt: new Date(), detailsEnc: sealGroup(g.id, { ...det, plan, templateId, templateName, workoutTitle }), rev: g.rev + 1 })
    .where(and(eq(groupSessions.id, g.id), sql`${groupSessions.workoutStartedAt} is null`))
    .returning();
  if (!claimed) throw conflict("The workout has already been pushed to this class.");
  const members = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.status, "CONFIRMED")));
  const exMap = await exerciseMapFor(g.coachId);
  const fresh = openGroup(claimed);
  let n = 0;
  for (const m of members) {
    const w = await buildWorkout(claimed, fresh, m.clientId, exMap);
    if (await insertWorkoutIfAbsent(w)) n++;
  }
  await notify(members.map((m) => m.clientId), "group_workout", { title: "Group workout started", body: `“${det.title}” is under way — your workout is ready on your Workout tab.`, link: `/classes/${g.id}` }, { email: false });
  return n;
}

/* ---------------- Shared sessions ---------------- */
export async function shareBooking(me: UserRow, bookingId: string, capacity: number): Promise<GroupRow> {
  const d = await db();
  const [b] = await d.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!b || b.clientId !== me.id) throw notFound("Booking not found.");
  if (b.status !== "CONFIRMED" && b.status !== "PENDING") throw badRequest("Only an upcoming session can be opened to partners.");
  if (b.startAt.getTime() < Date.now() + CLOSE_BEFORE_MIN * 60000) throw badRequest("It's too close to the start time to open this session to partners.");
  if (capacity < 2 || capacity > 8) throw badRequest("A shared session can hold between 2 and 8 people.");
  const [marked] = await d.select({ id: attendance.id }).from(attendance).where(and(eq(attendance.kind, "BOOKING"), eq(attendance.sessionId, bookingId))).limit(1);
  if (marked) throw badRequest("Attendance has already been marked for this session.");
  // A partner session uses the owner's group credit instead of a 1-on-1 credit.
  if ((await groupCreditsAvailable(me)) < 1) throw badRequest("A partner session uses one of your group class credits, and you have none free. Ask your coach to add some.");
  const [existing] = await d.select().from(groupSessions).where(and(eq(groupSessions.bookingId, bookingId), ne(groupSessions.status, "CANCELLED"))).limit(1);
  if (existing) throw conflict("This session is already open to partners.");
  const bk = toBooking(b);
  if (isHomeLocation(bk)) throw badRequest("Sessions at home stay private, so they can't be opened to partners.");
  await logCredit({ clientId: me.id, coachId: b.coachId, pool: "GROUP", kind: "RESERVED", delta: 0, sessionType: "Group Class", label: "Partner session", note: "Opened to partners — uses a group credit instead of a 1-on-1 credit" });
  return insertGroup({
    coachId: b.coachId,
    kind: "SHARED",
    start: b.startAt,
    end: b.endAt,
    capacity,
    bookingId,
    ownerId: me.id,
    details: { title: "Partner session", notes: "", gymId: bk.gymId, customGym: bk.customGym, place: bk.place },
  });
}

/** Is this one of the coach's clients, and do they have a group credit free? (Checked before a 1-on-1 is turned into a partner session.) */
export async function assertCanJoinGroup(me: UserRow, clientId: string): Promise<UserRow> {
  const cl = await loadClientFor(me, clientId);
  if (!cl) throw badRequest("That client isn't yours.");
  if ((await groupCreditsAvailable(cl)) < 1) throw badRequest("That client has no group class credits left. Add some first.");
  return cl;
}

/** Coach: puts a client into a class or partner session (the class screen, and walk-ins on the gym floor). Uses one of their group credits as usual. */
export async function coachAddMember(me: UserRow, g: GroupRow, clientId: string): Promise<void> {
  assertCoach(me, g);
  const d = await db();
  const det = openGroup(g);
  const cl = await loadClientFor(me, clientId);
  if (!cl) throw badRequest("That client isn't yours.");
  if (g.status !== "OPEN") throw badRequest("This class is closed.");
  const [cur] = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.clientId, clientId))).limit(1);
  if (cur && (cur.status === "CONFIRMED" || cur.status === "WAITLIST")) throw conflict("They're already in this class.");
  if ((await confirmedCount(g.id)) >= g.capacity) throw conflict("The class is full. Raise the number of spots first.");
  if ((await groupCreditsAvailable(cl)) < 1) throw badRequest("That client has no group class credits left. Add some first.");
  await d
    .insert(groupMembers)
    .values({ groupId: g.id, clientId, status: "CONFIRMED", role: "MEMBER" })
    .onConflictDoUpdate({ target: [groupMembers.groupId, groupMembers.clientId], set: { status: "CONFIRMED", role: "MEMBER", joinedAt: new Date() } });
  await logReserved(clientId, g.coachId, det.title);
  await notify([clientId], "group_added", { title: "You've been added to a class", body: `Your coach added you to “${det.title}” on ${await whenText(g.coachId, g.startAt)}.`, link: `/classes/${g.id}` });
  await ensureWorkoutFor(g, clientId);
}

/** Coach, gym floor: a client's 1-on-1 turns into a partner session so another client can join on the spot. Returns the session (the existing one if it already is). */
export async function shareBookingAsCoach(me: UserRow, bookingId: string): Promise<{ group: GroupRow; created: boolean }> {
  if (me.role === "CLIENT") throw forbidden();
  const d = await db();
  const [b] = await d.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!b || b.coachId !== me.id) throw notFound("Session not found.");
  const [existing] = await d.select().from(groupSessions).where(and(eq(groupSessions.bookingId, bookingId), ne(groupSessions.status, "CANCELLED"))).limit(1);
  if (existing) return { group: existing, created: false };
  if (b.status !== "CONFIRMED") throw badRequest("Only a confirmed session can take a partner.");
  const [marked] = await d.select({ id: attendance.id }).from(attendance).where(and(eq(attendance.kind, "BOOKING"), eq(attendance.sessionId, bookingId))).limit(1);
  if (marked) throw badRequest("Attendance has already been marked for this session.");
  const [owner] = await d.select().from(users).where(eq(users.id, b.clientId)).limit(1);
  if (!owner) throw notFound("Session not found.");
  if ((await groupCreditsAvailable(owner)) < 1) throw badRequest(`${await firstNameOf(owner)} has no group class credits, and a partner session uses one. Add a group credit first.`);
  const bk = toBooking(b);
  if (isHomeLocation(bk)) throw badRequest("Sessions at home stay private, so a partner can't be added.");
  await logCredit({ clientId: owner.id, coachId: b.coachId, pool: "GROUP", kind: "RESERVED", delta: 0, sessionType: "Group Class", label: "Partner session", note: "A partner joined on the day — uses a group credit instead of a 1-on-1 credit" });
  const group = await insertGroup({
    coachId: b.coachId,
    kind: "SHARED",
    start: b.startAt,
    end: b.endAt,
    capacity: SHARED_DEFAULT,
    bookingId,
    ownerId: owner.id,
    details: { title: "Partner session", notes: "", gymId: bk.gymId, customGym: bk.customGym, place: bk.place },
  });
  return { group, created: true };
}

/** Undoes a partner session that was made a moment ago for a walk-in that then could not be added. */
export async function undoShare(group: GroupRow): Promise<void> {
  const d = await db();
  await d.delete(groupMembers).where(eq(groupMembers.groupId, group.id));
  await d.delete(groupSessions).where(eq(groupSessions.id, group.id));
}

export async function requestJoin(me: UserRow, g: GroupRow): Promise<GroupRequestRow> {
  assertMyCoach(me, g);
  if (g.kind !== "SHARED") throw badRequest("Book a class spot directly.");
  if (g.status !== "OPEN") throw badRequest("This session isn't open any more.");
  if (g.startAt.getTime() < Date.now() + CLOSE_BEFORE_MIN * 60000) throw badRequest("Requests close 2 hours before the session starts.");
  const d = await db();
  const [own] = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.clientId, me.id))).limit(1);
  if (own && (own.status === "CONFIRMED" || own.status === "WAITLIST")) throw conflict("You're already in this session.");
  if ((await confirmedCount(g.id)) >= g.capacity) throw conflict("This session is full.");
  if ((await groupCreditsAvailable(me)) < 1) throw badRequest("You have no group class credits left. Ask your coach to add some.");
  const [pending] = await d.select().from(groupRequests).where(and(eq(groupRequests.groupId, g.id), eq(groupRequests.clientId, me.id), eq(groupRequests.status, "PENDING"))).limit(1);
  if (pending) throw conflict("You've already asked to join this session.");
  const expires = new Date(Math.min(Date.now() + REQUEST_HOURS * 3600000, g.startAt.getTime() - CLOSE_BEFORE_MIN * 60000));
  const id = newId("gr");
  const [row] = await d.insert(groupRequests).values({ id, groupId: g.id, clientId: me.id, expiresAt: expires }).returning();
  const approvers = await approversFor(g);
  const first = await firstNameOf(me);
  const det = openGroup(g);
  const when = await whenText(g.coachId, g.startAt);
  for (const uid of approvers) {
    const [u] = await d.select().from(users).where(eq(users.id, uid)).limit(1);
    const who = u && u.role !== "CLIENT" ? await fullNameOf(me) : first;
    await notify([uid], "join_request", { title: "Someone wants to join your session", body: `${who} asked to join “${det.title}” on ${when}. You and your coach both need to approve before they're added.`, link: `/classes/${g.id}` });
  }
  return row;
}

export async function decideRequest(me: UserRow, requestId: string, approve: boolean): Promise<GroupRequestRow | null> {
  const d = await db();
  const [rq] = await d.select().from(groupRequests).where(eq(groupRequests.id, requestId)).limit(1);
  if (!rq) throw notFound("That request doesn't exist.");
  if (rq.status !== "PENDING") throw conflict("That request has already been answered.");
  const g = await requireGroup(rq.groupId);
  const approvers = await approversFor(g);
  if (!approvers.includes(me.id)) throw forbidden("Only the coach and the people in this session can answer.");
  if (rq.expiresAt.getTime() < Date.now()) {
    await expireRequests(g.coachId);
    throw conflict("That request has expired.");
  }
  const approvals = parseApprovals(rq.approvals);
  approvals[me.id] = approve ? "APPROVED" : "DECLINED";
  await d.update(groupRequests).set({ approvals: JSON.stringify(approvals) }).where(eq(groupRequests.id, rq.id));
  return settleRequest(rq.id);
}

export async function cancelRequest(me: UserRow, requestId: string): Promise<void> {
  const d = await db();
  const [rq] = await d.select().from(groupRequests).where(eq(groupRequests.id, requestId)).limit(1);
  if (!rq || rq.clientId !== me.id) throw notFound("That request doesn't exist.");
  await d.update(groupRequests).set({ status: "CANCELLED" }).where(and(eq(groupRequests.id, requestId), eq(groupRequests.status, "PENDING")));
}

/* ---------------- Booking hooks (a shared session is tied to a 1-on-1 booking) ---------------- */
async function sharedFor(bookingId: string): Promise<GroupRow | null> {
  const d = await db();
  const [g] = await d.select().from(groupSessions).where(and(eq(groupSessions.bookingId, bookingId), ne(groupSessions.status, "CANCELLED"))).limit(1);
  return g ?? null;
}

/**
 * The booking's owner (or the coach) cancelled it. If partners had joined, the session passes to the one who joined
 * first and becomes their ordinary session, so nobody loses their place.
 */
export async function onBookingCancelled(bookingId: string, previousOwnerId: string): Promise<void> {
  const g = await sharedFor(bookingId);
  if (!g || g.status !== "OPEN") return;
  const d = await db();
  await setMark({ kind: "BOOKING", sessionId: bookingId, coachId: g.coachId, clientId: previousOwnerId, pool: "GROUP", mark: "CLEAR", sessionType: "Group Class", label: "Partner session" });
  const joiners = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.status, "CONFIRMED"), eq(groupMembers.role, "MEMBER"))).orderBy(asc(groupMembers.joinedAt));
  await d.update(groupMembers).set({ status: "CANCELLED" }).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.clientId, previousOwnerId)));
  await d.update(groupRequests).set({ status: "CANCELLED" }).where(and(eq(groupRequests.groupId, g.id), eq(groupRequests.status, "PENDING")));
  if (!joiners.length) {
    await d.update(groupSessions).set({ status: "CANCELLED", rev: g.rev + 1 }).where(eq(groupSessions.id, g.id));
    return;
  }
  const heir = joiners[0];
  // The heir now holds the session as its owner, so any partner mark of theirs is cleared (they are marked as the owner instead).
  await setMark({ kind: "GROUP", sessionId: g.id, coachId: g.coachId, clientId: heir.clientId, pool: "GROUP", mark: "CLEAR", sessionType: "Group Class", label: "Partner session" });
  await d.update(bookings).set({ clientId: heir.clientId, status: "CONFIRMED", rev: sql`${bookings.rev} + 1` }).where(eq(bookings.id, bookingId));
  await d.update(groupMembers).set({ role: "OWNER" }).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.clientId, heir.clientId)));
  await notify([heir.clientId], "session_transferred", { title: "The session is now yours", body: "The other client cancelled, so the shared session is now your own session. It's still booked — nothing else changes.", link: "/book" });
}

/** The booking was moved: keep the shared session on the same time and place, and tell the partners. */
export async function onBookingMoved(bookingId: string, start: Date, end: Date, loc: { gymId: string | null; customGym?: string; place?: PlaceInfo }): Promise<void> {
  const g = await sharedFor(bookingId);
  if (!g || g.status !== "OPEN") return;
  const d = await db();
  const det = openGroup(g);
  await d.update(groupSessions).set({ startAt: start, endAt: end, rev: g.rev + 1, detailsEnc: sealGroup(g.id, { ...det, gymId: loc.gymId, customGym: loc.customGym, place: loc.place }) }).where(eq(groupSessions.id, g.id));
  const partners = await d.select().from(groupMembers).where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.status, "CONFIRMED"), eq(groupMembers.role, "MEMBER")));
  await notify(partners.map((m) => m.clientId), "group_moved", { title: "Session time changed", body: `Your shared session moved to ${await whenText(g.coachId, start)}.`, link: `/classes/${g.id}` });
}

/** A client account is being deleted. */
export async function purgeClientGroups(clientId: string): Promise<void> {
  const d = await db();
  const owned = await d.select({ groupId: groupMembers.groupId }).from(groupMembers).where(and(eq(groupMembers.clientId, clientId), eq(groupMembers.role, "OWNER")));
  if (owned.length) await d.update(groupSessions).set({ status: "CANCELLED" }).where(inArray(groupSessions.id, owned.map((o) => o.groupId)));
  await d.delete(groupMembers).where(eq(groupMembers.clientId, clientId));
  await d.delete(groupRequests).where(eq(groupRequests.clientId, clientId));
  await d.delete(notifications).where(eq(notifications.userId, clientId));
}
