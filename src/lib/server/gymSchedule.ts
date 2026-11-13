import "server-only";
import { and, eq, gte, inArray, lt, ne, notInArray } from "drizzle-orm";
import { SEED_EXERCISES } from "@/data/exercises";
import type { Exercise, TemplateExercise, Workout } from "@/lib/types";
import { isMinorRow, openProfile } from "./accounts";
import { decryptJson } from "./crypto";
import { db } from "./db";
import { openGroup } from "./groups";
import { allGlobal } from "./niche";
import { toBooking } from "./schedule";
import { assignments, bookings, gymBranches, gymMembers, gymRoles, groupMembers, groupSessions, gyms, users, workouts, type UserRow } from "./schema";
import { customExercisesFor } from "./training";
import type { GymRow, Membership } from "./gymOrg";

const nameOfUser = (u: UserRow) => u.name ?? u.username;

/** A first name, or just "Client" for someone under 18 (the gym never sees a minor's name). */
function firstNameFor(u: UserRow): string {
  if (isMinorRow(u)) return "Client";
  try {
    return (openProfile(u).name || u.username).trim().split(/\s+/)[0] || "Client";
  } catch {
    return "Client";
  }
}

export interface WorkoutPeek {
  title: string;
  source: "logged" | "assigned" | "class plan";
  exercises: { name: string; sets: number }[];
}

export interface ScheduleItem {
  kind: "session" | "class";
  id: string;
  coachId: string;
  coachName: string;
  /** Set when the gym arranged cover: who this session belongs to. */
  originalCoachName?: string;
  start: string;
  end: string;
  status: string;
  location: string;
  branchId: string | null;
  title: string;
  /** The client of a 1-on-1 session (an id only: used to propose a permanent move). */
  clientId?: string;
  clients: string[];
  spotsTaken?: number;
  capacity?: number;
  workout?: WorkoutPeek;
  /** Another coach is in the same place at the same time (a warning, never a block). */
  clash: boolean;
}

export interface ScheduleResult {
  items: ScheduleItem[];
  coaches: { id: string; name: string }[];
  branches: { id: string; name: string }[];
}

const GONE = ["CANCELLED", "DECLINED"];

/** Resolves exercise ids to names: the built-in library, the shared niche library, and each coach's own (and their clients') custom ones. */
async function exerciseNames(coaches: UserRow[]): Promise<Map<string, string>> {
  const map = new Map<string, string>(SEED_EXERCISES.map((e: Exercise) => [e.id, e.name]));
  try {
    for (const e of await allGlobal([])) map.set(e.id, e.name);
  } catch {
    /* the shared library is optional */
  }
  for (const c of coaches) {
    try {
      for (const e of await customExercisesFor(c)) map.set(e.id, e.name);
    } catch {
      /* skip a coach whose library can't be read */
    }
  }
  return map;
}

/**
 * Every coach's sessions and classes in the gym between two dates. A session shows the time, coach, place, the client's first name
 * (or "Client" under 18) and the workout (what was logged, else what was assigned). Nothing else about the client.
 */
export async function masterSchedule(m: Membership, range: { from: Date; to: Date; coachId?: string; branchId?: string }): Promise<ScheduleResult> {
  const d = await db();
  const members = await d.select().from(gymMembers).where(and(eq(gymMembers.gymId, m.gym.id), eq(gymMembers.status, "ACTIVE")));
  const coachIds = members.map((x) => x.userId);
  const coachRows = coachIds.length ? await d.select().from(users).where(inArray(users.id, coachIds)) : [];
  const coachName = new Map(coachRows.map((c) => [c.id, nameOfUser(c)]));
  const branches = await d.select().from(gymBranches).where(eq(gymBranches.gymId, m.gym.id));
  const branchByName = new Map(branches.map((b) => [b.name.toLowerCase(), b.id]));
  const wanted = range.coachId ? coachIds.filter((c) => c === range.coachId) : coachIds;
  if (wanted.length === 0) return { items: [], coaches: coachRows.map((c) => ({ id: c.id, name: nameOfUser(c) })), branches: branches.map((b) => ({ id: b.id, name: b.name })) };

  const bks = await d
    .select()
    .from(bookings)
    .where(and(inArray(bookings.coachId, wanted), gte(bookings.startAt, range.from), lt(bookings.startAt, range.to), notInArray(bookings.status, GONE)));
  const grps = await d
    .select()
    .from(groupSessions)
    .where(and(inArray(groupSessions.coachId, wanted), gte(groupSessions.startAt, range.from), lt(groupSessions.startAt, range.to), ne(groupSessions.status, "CANCELLED")));
  // A partner session is a booking opened to partners: the booking already shows it.
  const classes = grps.filter((g) => !g.bookingId);

  const gymIds = new Set<string>();
  for (const b of bks) {
    const det = toBooking(b);
    if (det.gymId) gymIds.add(det.gymId);
  }
  for (const g of classes) {
    const det = openGroup(g);
    if (det.gymId) gymIds.add(det.gymId);
  }
  const venues = gymIds.size ? await d.select().from(gyms).where(inArray(gyms.id, [...gymIds])) : [];
  const venueName = new Map(venues.map((v) => [v.id, v.name]));

  const clientIds = [...new Set(bks.map((b) => b.clientId))];
  const memberRows = classes.length ? await d.select().from(groupMembers).where(and(inArray(groupMembers.groupId, classes.map((g) => g.id)), eq(groupMembers.role, "MEMBER"), inArray(groupMembers.status, ["CONFIRMED", "ATTENDED", "ABSENT"]))) : [];
  const allClientIds = [...new Set([...clientIds, ...memberRows.map((r) => r.clientId)])];
  const clientRows = allClientIds.length ? await d.select().from(users).where(inArray(users.id, allClientIds)) : [];
  const clientById = new Map(clientRows.map((u) => [u.id, u]));

  // Logged workouts around the window, matched to a session by its id.
  const wFrom = new Date(range.from.getTime() - 86_400_000);
  const wTo = new Date(range.to.getTime() + 86_400_000);
  const wrows = allClientIds.length ? await d.select().from(workouts).where(and(inArray(workouts.clientId, allClientIds), gte(workouts.startedAt, wFrom), lt(workouts.startedAt, wTo))) : [];
  const byBooking = new Map<string, Workout>();
  const byGroup = new Map<string, Workout>();
  for (const r of wrows) {
    try {
      const w = decryptJson<Workout>(r.dataEnc, `workout:${r.id}`);
      if (w.bookingId && !byBooking.has(w.bookingId)) byBooking.set(w.bookingId, { ...w, id: r.id });
      if (w.groupId && !byGroup.has(w.groupId)) byGroup.set(w.groupId, { ...w, id: r.id });
    } catch {
      /* unreadable: no workout shown */
    }
  }
  // What was assigned for the day (the coach's local date), when nothing was logged.
  const dayOf = (iso: Date, off: number) => new Date(iso.getTime() + off * 60_000).toISOString().slice(0, 10);
  const days = [...new Set(bks.map((b) => dayOf(b.startAt, 480)))];
  const arows = clientIds.length && days.length ? await d.select().from(assignments).where(and(inArray(assignments.clientId, clientIds), inArray(assignments.date, days))) : [];
  const assigned = new Map<string, { title: string; exercises: TemplateExercise[] }>();
  for (const a of arows) {
    try {
      const p = decryptJson<{ title: string; exercises: TemplateExercise[] }>(a.dataEnc, `assignment:${a.id}`);
      assigned.set(`${a.clientId}|${a.date}`, { title: p.title, exercises: p.exercises ?? [] });
    } catch {
      /* unreadable */
    }
  }
  const names = await exerciseNames(coachRows.filter((c) => wanted.includes(c.id)));
  const nm = (id: string) => names.get(id) ?? "Exercise";

  const items: ScheduleItem[] = [];
  const place = (id: string | null | undefined, custom: string | undefined, placeName: string | undefined) => (id ? venueName.get(id) : undefined) ?? custom ?? placeName ?? "Location not set";

  for (const b of bks) {
    const det = toBooking(b);
    const client = clientById.get(b.clientId);
    const location = place(det.gymId, det.customGym, det.place?.name);
    let workout: WorkoutPeek | undefined;
    const logged = byBooking.get(b.id);
    if (logged) workout = { title: logged.title, source: "logged", exercises: logged.exercises.map((e) => ({ name: nm(e.exerciseId), sets: e.sets.length })) };
    else {
      const a = assigned.get(`${b.clientId}|${dayOf(b.startAt, 480)}`);
      if (a) workout = { title: a.title, source: "assigned", exercises: a.exercises.map((e) => ({ name: nm(e.exerciseId), sets: e.sets })) };
    }
    items.push({
      kind: "session",
      id: b.id,
      coachId: b.coachId,
      coachName: coachName.get(b.coachId) ?? "Coach",
      ...(b.originalCoachId ? { originalCoachName: coachName.get(b.originalCoachId) ?? "another coach" } : {}),
      start: b.startAt.toISOString(),
      end: b.endAt.toISOString(),
      status: b.status,
      location,
      branchId: branchByName.get(location.toLowerCase()) ?? null,
      title: b.focus,
      clientId: b.clientId,
      clients: [client ? firstNameFor(client) : "Client"],
      ...(workout ? { workout } : {}),
      clash: false,
    });
  }
  for (const g of classes) {
    const det = openGroup(g);
    const location = place(det.gymId, det.customGym, det.place?.name);
    const members = memberRows.filter((r) => r.groupId === g.id);
    let workout: WorkoutPeek | undefined;
    const logged = byGroup.get(g.id);
    if (logged) workout = { title: logged.title, source: "logged", exercises: logged.exercises.map((e) => ({ name: nm(e.exerciseId), sets: e.sets.length })) };
    else if (det.plan?.length) workout = { title: det.workoutTitle || det.templateName || det.title, source: "class plan", exercises: det.plan.map((e) => ({ name: nm(e.exerciseId), sets: e.sets })) };
    items.push({
      kind: "class",
      id: g.id,
      coachId: g.coachId,
      coachName: coachName.get(g.coachId) ?? "Coach",
      ...(g.originalCoachId ? { originalCoachName: coachName.get(g.originalCoachId) ?? "another coach" } : {}),
      start: g.startAt.toISOString(),
      end: g.endAt.toISOString(),
      status: g.status,
      location,
      branchId: branchByName.get(location.toLowerCase()) ?? null,
      title: det.title,
      clients: members.map((r) => (clientById.get(r.clientId) ? firstNameFor(clientById.get(r.clientId)!) : "Client")),
      spotsTaken: members.length,
      capacity: g.capacity,
      ...(workout ? { workout } : {}),
      clash: false,
    });
  }

  // Two different coaches in the same place at the same time: a warning (never a block).
  const placed = items.filter((i) => i.location !== "Location not set");
  for (const a of placed)
    for (const b of placed)
      if (a !== b && a.coachId !== b.coachId && a.location.toLowerCase() === b.location.toLowerCase() && a.start < b.end && b.start < a.end) a.clash = true;

  let out = items.sort((a, b) => a.start.localeCompare(b.start));
  if (range.branchId) out = out.filter((i) => i.branchId === range.branchId);
  return { items: out, coaches: coachRows.map((c) => ({ id: c.id, name: nameOfUser(c) })).sort((a, b) => a.name.localeCompare(b.name)), branches: branches.map((b) => ({ id: b.id, name: b.name })) };
}

/* ---------------- Hours and payroll ---------------- */
export interface HoursRow {
  userId: string;
  name: string;
  roleName: string;
  sessions: number;
  classes: number;
  minutes: number;
  rateCents: number | null;
  /** Rate times hours, in cents (null when no rate is set). */
  amountCents: number | null;
}

/** Completed 1-on-1 sessions and group classes (attendance marked) per coach. Cover counts for the coach who did it. */
export async function hoursReport(gym: GymRow, range: { from: Date; to: Date }): Promise<{ rows: HoursRow[]; totals: { sessions: number; classes: number; minutes: number; amountCents: number | null }; countNoShows: boolean }> {
  const d = await db();
  const members = await d.select().from(gymMembers).where(and(eq(gymMembers.gymId, gym.id), eq(gymMembers.status, "ACTIVE")));
  const ids = members.map((x) => x.userId);
  if (ids.length === 0) return { rows: [], totals: { sessions: 0, classes: 0, minutes: 0, amountCents: null }, countNoShows: gym.countNoShows };
  const us = await d.select().from(users).where(inArray(users.id, ids));
  const name = new Map(us.map((u) => [u.id, nameOfUser(u)]));
  const roles = await d.select().from(gymRoles).where(eq(gymRoles.gymId, gym.id));
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  const counted = gym.countNoShows ? ["COMPLETED", "NO_SHOW"] : ["COMPLETED"];
  const bks = await d.select().from(bookings).where(and(inArray(bookings.coachId, ids), gte(bookings.startAt, range.from), lt(bookings.startAt, range.to), inArray(bookings.status, counted)));
  const cls = await d
    .select()
    .from(groupSessions)
    .where(and(inArray(groupSessions.coachId, ids), gte(groupSessions.startAt, range.from), lt(groupSessions.startAt, range.to), eq(groupSessions.status, "COMPLETED"), eq(groupSessions.kind, "CLASS")));

  const rows: HoursRow[] = members.map((mem) => {
    const mine = bks.filter((b) => b.coachId === mem.userId);
    const mineC = cls.filter((c) => c.coachId === mem.userId);
    const mins = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
    const minutes = mine.reduce((n, b) => n + mins(b.startAt, b.endAt), 0) + mineC.reduce((n, c) => n + mins(c.startAt, c.endAt), 0);
    return {
      userId: mem.userId,
      name: name.get(mem.userId) ?? "Former member",
      roleName: roleName.get(mem.roleId) ?? "—",
      sessions: mine.length,
      classes: mineC.length,
      minutes,
      rateCents: mem.rateCents,
      amountCents: mem.rateCents === null ? null : Math.round((minutes / 60) * mem.rateCents),
    };
  });
  rows.sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  const anyRate = rows.some((r) => r.amountCents !== null);
  return {
    rows,
    totals: { sessions: rows.reduce((n, r) => n + r.sessions, 0), classes: rows.reduce((n, r) => n + r.classes, 0), minutes: rows.reduce((n, r) => n + r.minutes, 0), amountCents: anyRate ? rows.reduce((n, r) => n + (r.amountCents ?? 0), 0) : null },
    countNoShows: gym.countNoShows,
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function hoursCsv(report: Awaited<ReturnType<typeof hoursReport>>, from: string, to: string): string {
  const lines = [["Coach", "Role", "1-on-1 sessions", "Classes", "Hours", "Hourly rate", "Amount"].map(csvCell).join(",")];
  for (const r of report.rows) lines.push([r.name, r.roleName, r.sessions, r.classes, (r.minutes / 60).toFixed(2), r.rateCents === null ? "" : (r.rateCents / 100).toFixed(2), r.amountCents === null ? "" : (r.amountCents / 100).toFixed(2)].map(csvCell).join(","));
  const t = report.totals;
  lines.push(["Total", "", t.sessions, t.classes, (t.minutes / 60).toFixed(2), "", t.amountCents === null ? "" : (t.amountCents / 100).toFixed(2)].map(csvCell).join(","));
  lines.push("", `Period,${from} to ${to}`, `No-shows counted,${report.countNoShows ? "yes" : "no"}`);
  return lines.join("\n");
}

/** The numbers on the gym's home screen: coaches, sessions this week, hours this month and who is waiting. No client counts. */
export async function gymOverview(m: Membership): Promise<{ coaches: number; pending: number; sessionsThisWeek: number; hoursThisMonth: number; coversThisWeek: number }> {
  const d = await db();
  const mems = await d.select().from(gymMembers).where(eq(gymMembers.gymId, m.gym.id));
  const active = mems.filter((x) => x.status === "ACTIVE");
  const ids = active.map((x) => x.userId);
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  let sessionsThisWeek = 0, coversThisWeek = 0;
  if (ids.length) {
    const wk = await d.select().from(bookings).where(and(inArray(bookings.coachId, ids), gte(bookings.startAt, weekStart), lt(bookings.startAt, weekEnd), notInArray(bookings.status, GONE)));
    const wg = await d.select().from(groupSessions).where(and(inArray(groupSessions.coachId, ids), gte(groupSessions.startAt, weekStart), lt(groupSessions.startAt, weekEnd), ne(groupSessions.status, "CANCELLED"), eq(groupSessions.kind, "CLASS")));
    sessionsThisWeek = wk.length + wg.filter((g) => !g.bookingId).length;
    coversThisWeek = wk.filter((b) => b.originalCoachId).length + wg.filter((g) => g.originalCoachId).length;
  }
  const report = await hoursReport(m.gym, { from: monthStart, to: monthEnd });
  return { coaches: active.length, pending: mems.length - active.length, sessionsThisWeek, hoursThisMonth: Math.round((report.totals.minutes / 60) * 10) / 10, coversThisWeek };
}

