import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { AT_RISK_DAYS, daysSince, histogram, isAtRisk, lastMonths, localParts, onMonths, pct, retention, summariseClasses, type ClassEventRow, type ClassRow, type CoachPerf, type OccupancySummary } from "@/lib/business";
import { todayIn } from "@/lib/packageExpiry";
import { openProfile } from "./accounts";
import { billingOverview } from "./billing";
import { db } from "./db";
import { forbidden } from "./http";
import { openGroup } from "./groups";
import { membershipOf } from "./gymOrg";
import { referralTotals } from "./referrals";
import { attendance, bookings, classEvents, coachBilling, gymMembers, gymOrgs, groupMembers, groupSessions, paymentOrders, users, workouts, type UserRow } from "./schema";

/*
 * The business dashboards. Three views, each reading only what that person may already see:
 *  - a coach: their own income (payments they recorded), sessions, clients who need attention, busy times;
 *  - a gym (anyone with the schedule or hours permission): sessions and hours per coach, busy times, class fill. Counts only: never a
 *    client's name, health details or payment (a gym never sees those anywhere else either);
 *  - the owner: the platform (coaches, trials turning into subscriptions, income, sign-ups, referrals).
 * Months and days are counted in Singapore time (APP_TZ).
 */

const MONTH = (col: unknown) => sql<string>`to_char(${col} at time zone 'Asia/Singapore', 'YYYY-MM')`;
const DOW = (col: unknown) => sql<number>`extract(dow from ${col} at time zone 'Asia/Singapore')::int`;
const HOUR = (col: unknown) => sql<number>`extract(hour from ${col} at time zone 'Asia/Singapore')::int`;
const tzToday = (now: Date) => todayIn(process.env.APP_TZ || undefined, now);

/* ---------------- Class occupancy and coach performance (shared by the coach, gym and export views) ---------------- */
type ClassRowWithCoach = ClassRow & { coachId: string };

/** Every class these coaches held in the last 200 days (plus the waitlist and cancellation events of the last 90). Counts only. */
async function loadClassData(ids: string[], now: Date): Promise<{ rows: ClassRowWithCoach[]; events: ClassEventRow[] }> {
  if (!ids.length) return { rows: [], events: [] };
  const d = await db();
  const since = new Date(now.getTime() - 200 * 86_400_000);
  const day90 = new Date(now.getTime() - 90 * 86_400_000);
  const where = and(inArray(groupSessions.coachId, ids), eq(groupSessions.kind, "CLASS"), inArray(groupSessions.status, ["COMPLETED", "OPEN"]), gte(groupSessions.startAt, since), lte(groupSessions.startAt, now));
  const [groups, counts, events] = await Promise.all([
    d.select().from(groupSessions).where(where),
    d
      .select({
        groupId: groupMembers.groupId,
        booked: sql<number>`count(*) filter (where ${groupMembers.status} in ('CONFIRMED','ATTENDED','ABSENT'))::int`,
        attended: sql<number>`count(*) filter (where ${groupMembers.status} = 'ATTENDED')::int`,
        absent: sql<number>`count(*) filter (where ${groupMembers.status} = 'ABSENT')::int`,
      })
      .from(groupMembers)
      .innerJoin(groupSessions, eq(groupMembers.groupId, groupSessions.id))
      .where(where)
      .groupBy(groupMembers.groupId),
    d.select({ groupId: classEvents.groupId, kind: classEvents.kind }).from(classEvents).where(and(inArray(classEvents.coachId, ids), gte(classEvents.createdAt, day90))),
  ]);
  const by = new Map(counts.map((c) => [c.groupId, c]));
  const tz = process.env.APP_TZ || undefined;
  const rows = groups.map((g) => {
    const c = by.get(g.id);
    const p = localParts(g.startAt, tz);
    return { id: g.id, coachId: g.coachId, title: openGroup(g).title, weekday: p.weekday, hour: p.hour, month: p.month, t: g.startAt.getTime(), capacity: g.capacity, booked: c?.booked ?? 0, attended: c?.attended ?? 0, absent: c?.absent ?? 0 };
  });
  return { rows, events: events as ClassEventRow[] };
}

export interface ClassData {
  rows: ClassRowWithCoach[];
  events: ClassEventRow[];
}
export const classDataFor = loadClassData;

/** Occupancy for these coaches' classes (the gym's, or one coach's own). */
export function occupancyOf(data: ClassData, now: Date): OccupancySummary {
  return summariseClasses(data.rows, data.events, lastMonths(6, tzToday(now)), now.getTime());
}

/** One row of numbers per coach. A gym passes all its active coaches; a coach passes only themselves. */
export async function coachPerformance(ids: string[], data: ClassData, now: Date): Promise<CoachPerf[]> {
  if (!ids.length) return [];
  const d = await db();
  const t = now.getTime();
  const day = (n: number) => new Date(t - n * 86_400_000);
  const iso = (n: number) => day(n).toISOString();

  const [people, clientRows, bk, att] = await Promise.all([
    d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)),
    d.select({ id: users.id, coachId: users.coachId, active: users.active, createdAt: users.createdAt }).from(users).where(and(eq(users.role, "CLIENT"), inArray(users.coachId, ids))),
    d
      .select({
        coachId: bookings.coachId,
        done30: sql<number>`count(*) filter (where ${bookings.status} = 'COMPLETED' and ${bookings.startAt} >= ${iso(30)}::timestamptz)::int`,
        donePrev: sql<number>`count(*) filter (where ${bookings.status} = 'COMPLETED' and ${bookings.startAt} >= ${iso(60)}::timestamptz and ${bookings.startAt} < ${iso(30)}::timestamptz)::int`,
        seconds30: sql<number>`coalesce(sum(extract(epoch from (${bookings.endAt} - ${bookings.startAt}))) filter (where ${bookings.status} = 'COMPLETED' and ${bookings.startAt} >= ${iso(30)}::timestamptz),0)::float`,
        done90: sql<number>`count(*) filter (where ${bookings.status} = 'COMPLETED')::int`,
        noShow90: sql<number>`count(*) filter (where ${bookings.status} = 'NO_SHOW')::int`,
        cancelled90: sql<number>`count(*) filter (where ${bookings.status} = 'CANCELLED')::int`,
      })
      .from(bookings)
      .where(and(inArray(bookings.coachId, ids), gte(bookings.startAt, day(90)), lte(bookings.startAt, now)))
      .groupBy(bookings.coachId),
    d
      .select({ coachId: attendance.coachId, mark: attendance.mark, n: sql<number>`count(*)::int` })
      .from(attendance)
      .where(and(inArray(attendance.coachId, ids), gte(attendance.markedAt, day(90))))
      .groupBy(attendance.coachId, attendance.mark),
  ]);

  const clientIds = clientRows.map((c) => c.id);
  const activeIds = clientRows.filter((c) => c.active).map((c) => c.id);
  const [lastB, lastA, wk] = clientIds.length
    ? await Promise.all([
        d.select({ clientId: bookings.clientId, last: sql<Date>`max(${bookings.startAt})`.mapWith(bookings.startAt) }).from(bookings).where(and(inArray(bookings.clientId, clientIds), eq(bookings.status, "COMPLETED"), lte(bookings.startAt, now))).groupBy(bookings.clientId),
        d.select({ clientId: attendance.clientId, last: sql<Date>`max(${attendance.markedAt})`.mapWith(attendance.markedAt) }).from(attendance).where(and(inArray(attendance.clientId, clientIds), eq(attendance.mark, "PRESENT"))).groupBy(attendance.clientId),
        activeIds.length
          ? d
              .select({ clientId: workouts.clientId, n28: sql<number>`count(*)::int`, n14: sql<number>`count(*) filter (where ${workouts.startedAt} >= ${iso(14)}::timestamptz)::int` })
              .from(workouts)
              .where(and(inArray(workouts.clientId, activeIds), eq(workouts.status, "DONE"), gte(workouts.startedAt, day(28))))
              .groupBy(workouts.clientId)
          : Promise.resolve([]),
      ])
    : [[], [], []];

  const lastOf = new Map<string, number>();
  for (const r of [...lastB, ...lastA]) if (r.last) lastOf.set(r.clientId, Math.max(lastOf.get(r.clientId) ?? 0, r.last.getTime()));
  const wkOf = new Map(wk.map((w) => [w.clientId, w]));
  const nameOf = new Map(people.map((p) => [p.id, p.name ?? "Coach"]));

  return ids.map((id) => {
    const mine = clientRows.filter((c) => c.coachId === id);
    const active = mine.filter((c) => c.active);
    const ret = mine.map((c) => ({ since: c.createdAt.getTime(), active: c.active, last: lastOf.get(c.id) ?? null }));
    const b = bk.find((x) => x.coachId === id);
    const present = att.find((a) => a.coachId === id && a.mark === "PRESENT")?.n ?? 0;
    const noShow = att.find((a) => a.coachId === id && a.mark === "NO_SHOW")?.n ?? 0;
    const classes = data.rows.filter((r) => r.coachId === id && r.t >= t - 30 * 86_400_000);
    const workoutsAll = active.reduce((s, c) => s + (wkOf.get(c.id)?.n28 ?? 0), 0);
    const engaged = active.filter((c) => (wkOf.get(c.id)?.n14 ?? 0) > 0).length;
    const booked = (b?.done90 ?? 0) + (b?.noShow90 ?? 0) + (b?.cancelled90 ?? 0);
    return {
      id,
      name: nameOf.get(id) ?? "Coach",
      clients: active.length,
      sessions30: b?.done30 ?? 0,
      sessionsPrev30: b?.donePrev ?? 0,
      hours30: Math.round(((b?.seconds30 ?? 0) / 3600) * 10) / 10,
      classes30: classes.length,
      classFillPct: pct(
        classes.reduce((s, r) => s + r.booked, 0),
        classes.reduce((s, r) => s + r.capacity, 0),
      ),
      classAttendees30: classes.reduce((s, r) => s + r.attended, 0),
      attendancePct: pct(present, present + noShow),
      noShows90: b?.noShow90 ?? 0,
      cancelPct: pct(b?.cancelled90 ?? 0, booked),
      cancels90: b?.cancelled90 ?? 0,
      retention: { m1: retention(ret, t, 1), m3: retention(ret, t, 3), m6: retention(ret, t, 6) },
      workoutsPerClientWeek: active.length ? Math.round((workoutsAll / active.length / 4) * 10) / 10 : null,
      engagedPct: pct(engaged, active.length),
    };
  });
}

/* ---------------- A coach ---------------- */
export interface CoachBusiness {
  months: string[];
  revenue: { month: string; cents: number; payments: number }[];
  revenueThisMonth: number;
  revenueLastMonth: number;
  hasPayments: boolean;
  outstandingCents: number;
  refundedCents: number;
  sessions: { month: string; done: number; noShow: number; cancelled: number }[];
  classes: { month: string; ran: number; attendees: number }[];
  sessionsThisMonth: number;
  sessionsLastMonth: number;
  clients: { active: number; newThisMonth: number; activeLast30: number; activePct: number | null };
  atRisk: { id: string; name: string; days: number | null; credits: number }[];
  lowCredits: { id: string; name: string; credits: number }[];
  byWeekday: number[];
  byHour: number[];
  topPackages: { name: string; sold: number; cents: number }[];
  attendance: { present: number; noShow: number; ratePct: number | null };
  /** Their own performance numbers, and the occupancy of their own classes (null when they hold none). */
  performance: CoachPerf;
  occupancy: OccupancySummary | null;
}

export async function coachBusiness(me: UserRow, now = new Date()): Promise<CoachBusiness> {
  const d = await db();
  const classData = await loadClassData([me.id], now);
  const today = tzToday(now);
  const months = lastMonths(6, today);
  const since = new Date(now.getTime() - 200 * 86_400_000);
  const day90 = new Date(now.getTime() - 90 * 86_400_000);
  const day30 = new Date(now.getTime() - 30 * 86_400_000);
  const thisM = months[months.length - 1];
  const lastM = months[months.length - 2];

  const [paid, refunds, owed, sess, cls, byDow, byHour, pkgs, att] = await Promise.all([
    d
      .select({ month: MONTH(paymentOrders.paidAt), cents: sql<number>`coalesce(sum(${paymentOrders.amountCents}),0)::int`, payments: sql<number>`count(*)::int` })
      .from(paymentOrders)
      .where(and(eq(paymentOrders.coachId, me.id), eq(paymentOrders.status, "PAID"), gte(paymentOrders.paidAt, since)))
      .groupBy(MONTH(paymentOrders.paidAt)),
    d
      .select({ cents: sql<number>`coalesce(sum(${paymentOrders.amountCents}),0)::int` })
      .from(paymentOrders)
      .where(and(eq(paymentOrders.coachId, me.id), eq(paymentOrders.status, "REFUNDED"), gte(paymentOrders.refundedAt, since))),
    d
      .select({ cents: sql<number>`coalesce(sum(${paymentOrders.amountCents}),0)::int` })
      .from(paymentOrders)
      .where(and(eq(paymentOrders.coachId, me.id), inArray(paymentOrders.status, ["PENDING", "AWAITING"]))),
    d
      .select({ month: MONTH(bookings.startAt), status: bookings.status, n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.coachId, me.id), gte(bookings.startAt, since), inArray(bookings.status, ["COMPLETED", "NO_SHOW", "CANCELLED"])))
      .groupBy(MONTH(bookings.startAt), bookings.status),
    d
      .select({ month: MONTH(groupSessions.startAt), ran: sql<number>`count(distinct ${groupSessions.id})::int`, attendees: sql<number>`count(${groupMembers.clientId}) filter (where ${groupMembers.status} = 'ATTENDED')::int` })
      .from(groupSessions)
      .leftJoin(groupMembers, eq(groupMembers.groupId, groupSessions.id))
      .where(and(eq(groupSessions.coachId, me.id), eq(groupSessions.status, "COMPLETED"), gte(groupSessions.startAt, since)))
      .groupBy(MONTH(groupSessions.startAt)),
    d
      .select({ slot: DOW(bookings.startAt), n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.coachId, me.id), gte(bookings.startAt, day90), inArray(bookings.status, ["COMPLETED", "CONFIRMED", "NO_SHOW"])))
      .groupBy(DOW(bookings.startAt)),
    d
      .select({ slot: HOUR(bookings.startAt), n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.coachId, me.id), gte(bookings.startAt, day90), inArray(bookings.status, ["COMPLETED", "CONFIRMED", "NO_SHOW"])))
      .groupBy(HOUR(bookings.startAt)),
    d
      .select({ name: paymentOrders.name, sold: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${paymentOrders.amountCents}),0)::int` })
      .from(paymentOrders)
      .where(and(eq(paymentOrders.coachId, me.id), eq(paymentOrders.status, "PAID"), gte(paymentOrders.paidAt, since)))
      .groupBy(paymentOrders.name)
      .orderBy(desc(sql`sum(${paymentOrders.amountCents})`))
      .limit(5),
    d
      .select({ mark: attendance.mark, n: sql<number>`count(*)::int` })
      .from(attendance)
      .where(and(eq(attendance.coachId, me.id), gte(attendance.markedAt, day90)))
      .groupBy(attendance.mark),
  ]);

  const revenue = onMonths(months, paid, { cents: 0, payments: 0 });
  const sessions = months.map((m) => {
    const row = (s: string) => sess.find((r) => r.month === m && r.status === s)?.n ?? 0;
    return { month: m, done: row("COMPLETED"), noShow: row("NO_SHOW"), cancelled: row("CANCELLED") };
  });
  const classes = onMonths(months, cls, { ran: 0, attendees: 0 });

  // Clients: who is active, who needs a call, whose package is nearly used up.
  const clientRows = await d.select().from(users).where(and(eq(users.role, "CLIENT"), eq(users.coachId, me.id), eq(users.active, true)));
  const lastSessions = await d
    .select({ clientId: bookings.clientId, last: sql<Date>`max(${bookings.startAt})`.mapWith(bookings.startAt) })
    .from(bookings)
    .where(and(eq(bookings.coachId, me.id), eq(bookings.status, "COMPLETED")))
    .groupBy(bookings.clientId);
  const lastBy = new Map(lastSessions.map((l) => [l.clientId, l.last]));
  const people = clientRows.map((r) => {
    let name = "Client";
    let credits = 0;
    try {
      const p = openProfile(r);
      name = p.name?.trim() || "Client";
      credits = p.credits;
    } catch {
      /* unreadable profile: still counted */
    }
    return { id: r.id, name, credits, since: r.createdAt, last: lastBy.get(r.id) ?? null };
  });
  const activeLast30 = people.filter((p) => p.last && p.last.getTime() >= day30.getTime()).length;
  const atRisk = people
    .filter((p) => isAtRisk(p.last, p.since, now))
    .sort((a, b) => (a.last?.getTime() ?? 0) - (b.last?.getTime() ?? 0))
    .slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name, days: p.last ? daysSince(p.last, now) : null, credits: p.credits }));
  const lowCredits = people
    .filter((p) => p.credits <= 1)
    .sort((a, b) => a.credits - b.credits)
    .slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name, credits: p.credits }));

  const present = att.find((a) => a.mark === "PRESENT")?.n ?? 0;
  const noShow = att.find((a) => a.mark === "NO_SHOW")?.n ?? 0;
  const monthSessions = (m: string) => (sessions.find((s) => s.month === m)?.done ?? 0) + (classes.find((c) => c.month === m)?.ran ?? 0);

  return {
    months,
    revenue,
    revenueThisMonth: revenue.find((r) => r.month === thisM)?.cents ?? 0,
    revenueLastMonth: revenue.find((r) => r.month === lastM)?.cents ?? 0,
    hasPayments: paid.length > 0 || (owed[0]?.cents ?? 0) > 0,
    outstandingCents: owed[0]?.cents ?? 0,
    refundedCents: refunds[0]?.cents ?? 0,
    sessions,
    classes,
    sessionsThisMonth: monthSessions(thisM),
    sessionsLastMonth: monthSessions(lastM),
    clients: {
      active: people.length,
      newThisMonth: people.filter((p) => tzMonth(p.since) === thisM).length,
      activeLast30,
      activePct: pct(activeLast30, people.length),
    },
    atRisk,
    lowCredits,
    byWeekday: histogram(7, byDow),
    byHour: histogram(24, byHour),
    topPackages: pkgs,
    attendance: { present, noShow, ratePct: pct(present, present + noShow) },
    performance: (await coachPerformance([me.id], classData, now))[0],
    occupancy: classData.rows.length || classData.events.length ? occupancyOf(classData, now) : null,
  };
}

/** The Singapore month ("YYYY-MM") of an instant. */
const tzMonth = (when: Date): string => tzToday(when).slice(0, 7);

/* ---------------- A gym ---------------- */
export interface GymBusiness {
  gymName: string;
  months: string[];
  sessionsByMonth: { month: string; done: number }[];
  coaches: { id: string; name: string; sessions30: number; hours30: number; noShows30: number; cancels30: number; classes30: number }[];
  byWeekday: number[];
  byHour: number[];
  classFill: { classes: number; capacity: number; filled: number; pct: number | null };
  activeCoaches: number;
  waiting: number;
  /** Class occupancy for the whole gym, and each coach's performance (null unless the viewer may see hours and payroll). */
  occupancy: OccupancySummary;
  performance: CoachPerf[] | null;
}

export async function gymBusiness(me: UserRow, now = new Date()): Promise<GymBusiness> {
  const m = await membershipOf(me.id);
  if (!m || m.member.status !== "ACTIVE" || m.gym.status !== "ACTIVE" || !(m.perms.includes("schedule.view") || m.perms.includes("hours.view"))) throw forbidden("Your gym role doesn't allow that.");
  const d = await db();
  const members = await d.select().from(gymMembers).where(eq(gymMembers.gymId, m.gym.id));
  const activeIds = members.filter((x) => x.status === "ACTIVE").map((x) => x.userId);
  const waiting = members.filter((x) => x.status === "PENDING").length;
  const months = lastMonths(6, tzToday(now));
  const since = new Date(now.getTime() - 200 * 86_400_000);
  const day90 = new Date(now.getTime() - 90 * 86_400_000);
  const day30 = new Date(now.getTime() - 30 * 86_400_000);

  const empty: GymBusiness = {
    gymName: m.gym.name,
    months,
    sessionsByMonth: months.map((x) => ({ month: x, done: 0 })),
    coaches: [],
    byWeekday: histogram(7, []),
    byHour: histogram(24, []),
    classFill: { classes: 0, capacity: 0, filled: 0, pct: null },
    activeCoaches: 0,
    waiting,
    occupancy: summariseClasses([], [], months, now.getTime()),
    performance: null,
  };
  if (!activeIds.length) return empty;
  // Occupancy follows the schedule permission; coach performance is as sensitive as hours and payroll, so it follows that one.
  const classData = await loadClassData(activeIds, now);
  const perf = m.perms.includes("hours.view") ? await coachPerformance(activeIds, classData, now) : null;

  const [monthly, perCoach, perClass, byDow, byHour, fill, people] = await Promise.all([
    d
      .select({ month: MONTH(bookings.startAt), done: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(inArray(bookings.coachId, activeIds), eq(bookings.status, "COMPLETED"), gte(bookings.startAt, since)))
      .groupBy(MONTH(bookings.startAt)),
    d
      .select({
        coachId: bookings.coachId,
        done: sql<number>`count(*) filter (where ${bookings.status} = 'COMPLETED')::int`,
        noShow: sql<number>`count(*) filter (where ${bookings.status} = 'NO_SHOW')::int`,
        cancelled: sql<number>`count(*) filter (where ${bookings.status} = 'CANCELLED')::int`,
        hours: sql<number>`coalesce(sum(extract(epoch from (${bookings.endAt} - ${bookings.startAt}))) filter (where ${bookings.status} = 'COMPLETED'),0)::float`,
      })
      .from(bookings)
      .where(and(inArray(bookings.coachId, activeIds), gte(bookings.startAt, day30)))
      .groupBy(bookings.coachId),
    d
      .select({ coachId: groupSessions.coachId, n: sql<number>`count(*)::int` })
      .from(groupSessions)
      .where(and(inArray(groupSessions.coachId, activeIds), eq(groupSessions.status, "COMPLETED"), gte(groupSessions.startAt, day30)))
      .groupBy(groupSessions.coachId),
    d
      .select({ slot: DOW(bookings.startAt), n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(inArray(bookings.coachId, activeIds), gte(bookings.startAt, day90), inArray(bookings.status, ["COMPLETED", "CONFIRMED", "NO_SHOW"])))
      .groupBy(DOW(bookings.startAt)),
    d
      .select({ slot: HOUR(bookings.startAt), n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(inArray(bookings.coachId, activeIds), gte(bookings.startAt, day90), inArray(bookings.status, ["COMPLETED", "CONFIRMED", "NO_SHOW"])))
      .groupBy(HOUR(bookings.startAt)),
    d
      .select({
        classes: sql<number>`count(distinct ${groupSessions.id})::int`,
        capacity: sql<number>`coalesce(sum(${groupSessions.capacity}),0)::int`,
        filled: sql<number>`count(${groupMembers.clientId}) filter (where ${groupMembers.status} in ('CONFIRMED','ATTENDED','ABSENT'))::int`,
      })
      .from(groupSessions)
      .leftJoin(groupMembers, eq(groupMembers.groupId, groupSessions.id))
      .where(and(inArray(groupSessions.coachId, activeIds), eq(groupSessions.kind, "CLASS"), gte(groupSessions.startAt, day30), inArray(groupSessions.status, ["COMPLETED", "OPEN"]))),
    d.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, activeIds)),
  ]);

  const nameOf = new Map(people.map((p) => [p.id, p.name ?? "Coach"]));
  const by = new Map(perCoach.map((r) => [r.coachId, r]));
  const classBy = new Map(perClass.map((r) => [r.coachId, r.n]));
  const coaches = activeIds
    .map((id) => {
      const r = by.get(id);
      return { id, name: nameOf.get(id) ?? "Coach", sessions30: r?.done ?? 0, hours30: Math.round(((r?.hours ?? 0) / 3600) * 10) / 10, noShows30: r?.noShow ?? 0, cancels30: r?.cancelled ?? 0, classes30: classBy.get(id) ?? 0 };
    })
    .sort((a, b) => b.sessions30 + b.classes30 - (a.sessions30 + a.classes30));
  const f = fill[0] ?? { classes: 0, capacity: 0, filled: 0 };

  return {
    ...empty,
    sessionsByMonth: onMonths(months, monthly, { done: 0 }),
    coaches,
    byWeekday: histogram(7, byDow),
    byHour: histogram(24, byHour),
    classFill: { classes: f.classes, capacity: f.capacity, filled: f.filled, pct: pct(f.filled, f.capacity) },
    activeCoaches: activeIds.length,
    occupancy: occupancyOf(classData, now),
    performance: perf ? perf.sort((a, b) => b.sessions30 + b.classes30 - (a.sessions30 + a.classes30)) : null,
  };
}

/* ---------------- The platform owner ---------------- */
export interface OwnerBusiness {
  coaches: { total: number; paying: number; trialing: number; exempt: number; trialEnded: number };
  mrrCents: number;
  conversionPct: number | null;
  weeks: { week: string; coaches: number; solo: number; clients: number }[];
  signups30: { coaches: number; solo: number; clients: number };
  activeThisWeek: { coaches: number; solo: number; clients: number };
  gyms: { total: number; active: number };
  referrals: { invited: number; subscribed: number; rewarded: number; friends: { clients: number; solo: number } };
  verifiedPct: number | null;
}

const addDaysIso = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The Monday on or before a yyyy-MM-dd date. */
const mondayOf = (iso: string): string => addDaysIso(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

export async function ownerBusiness(now = new Date()): Promise<OwnerBusiness> {
  const d = await db();
  const today = tzToday(now);
  const firstWeek = addDaysIso(mondayOf(today), -77); // twelve weeks: this one and the eleven before
  const since = new Date(`${firstWeek}T00:00:00+08:00`);
  const day30 = new Date(now.getTime() - 30 * 86_400_000);
  const day7 = new Date(now.getTime() - 7 * 86_400_000);
  const kind = sql<string>`case when ${users.role} in ('OWNER','COACH') then 'coach' when ${users.coachId} is null then 'personal' else 'client' end`;
  const WEEK = sql<string>`to_char(date_trunc('week', ${users.createdAt} at time zone 'Asia/Singapore'), 'YYYY-MM-DD')`;

  const [weekly, last30, active7, verified, billingRows, gyms, overview, refs] = await Promise.all([
    d.select({ week: WEEK, kind, n: sql<number>`count(*)::int` }).from(users).where(and(gte(users.createdAt, since), sql`${users.role} <> 'OWNER'`)).groupBy(WEEK, kind),
    d.select({ kind, n: sql<number>`count(*)::int` }).from(users).where(and(gte(users.createdAt, day30), sql`${users.role} <> 'OWNER'`)).groupBy(kind),
    d.select({ kind, n: sql<number>`count(*)::int` }).from(users).where(and(gte(users.lastLoginAt, day7), sql`${users.role} <> 'OWNER'`)).groupBy(kind),
    d.select({ total: sql<number>`count(*)::int`, ok: sql<number>`count(*) filter (where ${users.emailVerified})::int` }).from(users).where(sql`${users.role} <> 'OWNER'`),
    d.select({ exempt: coachBilling.exempt, status: coachBilling.status, trialEnd: coachBilling.trialEnd, sub: coachBilling.stripeSubscriptionId }).from(coachBilling),
    d.select({ status: gymOrgs.status }).from(gymOrgs),
    billingOverview(),
    referralTotals(),
  ]);

  const weeks: OwnerBusiness["weeks"] = [];
  for (let i = 0; i < 12; i++) {
    const wk = addDaysIso(firstWeek, i * 7);
    const n = (k: string) => weekly.find((r) => r.week === wk && r.kind === k)?.n ?? 0;
    weeks.push({ week: wk, coaches: n("coach"), solo: n("personal"), clients: n("client") });
  }
  const count = (rows: { kind: string; n: number }[], k: string) => rows.find((r) => r.kind === k)?.n ?? 0;

  const payers = billingRows.filter((b) => !b.exempt);
  const paying = payers.filter((b) => b.status === "ACTIVE" && b.sub).length;
  const trialing = payers.filter((b) => !b.sub && b.status === "TRIALING" && b.trialEnd && b.trialEnd.getTime() > now.getTime()).length;
  const trialEnded = payers.filter((b) => !b.sub && b.trialEnd && b.trialEnd.getTime() <= now.getTime()).length;
  // Of the coaches whose free trial is over, how many are paying.
  const decided = paying + trialEnded + payers.filter((b) => b.status === "CANCELED").length;

  return {
    coaches: { total: billingRows.length, paying, trialing, exempt: billingRows.length - payers.length, trialEnded },
    mrrCents: overview.totals.mrrCents,
    conversionPct: pct(paying, decided),
    weeks,
    signups30: { coaches: count(last30, "coach"), solo: count(last30, "personal"), clients: count(last30, "client") },
    activeThisWeek: { coaches: count(active7, "coach"), solo: count(active7, "personal"), clients: count(active7, "client") },
    gyms: { total: gyms.length, active: gyms.filter((g) => g.status === "ACTIVE").length },
    referrals: refs,
    verifiedPct: pct(verified[0]?.ok ?? 0, verified[0]?.total ?? 0),
  };
}

export const AT_RISK_AFTER_DAYS = AT_RISK_DAYS;
