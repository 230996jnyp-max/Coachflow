import { differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import { LOW_CREDITS } from "./coachEye";
import { availableCredits } from "./scheduling";
import type { ClientProfile, DB, GroupSession, User } from "./types";

/*
 * "Who needs me today?" — pure functions that turn what the app already knows (logged workouts, attended sessions and classes,
 * credits, no-shows) into a weekly target score and a short list of reasons to look at a client.
 *
 * Training days. Several things count as training: a finished workout, an attended 1-on-1 session and an attended class. They can
 * be the same real session (the coach logs a workout on the gym floor for a booking), so we count DAYS with any of them, not
 * events. Two sessions on one day count once.
 */

/** Sessions a week when the coach has not set a target for the client. */
export const DEFAULT_WEEKLY_TARGET = 3;
/** Quiet = nothing logged or attended for this many days. */
export const QUIET_DAYS = 7;
/** A client younger than this (in days) is never called "quiet" or "behind": they have only just started. */
export const NEW_CLIENT_DAYS = 7;
/** A client still on their first password for longer than this is flagged ("hasn't logged in yet"). */
export const NO_LOGIN_FLAG_DAYS = 3;

const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

export function weeklyTargetOf(profile: Pick<ClientProfile, "weeklyTarget"> | undefined): number {
  const t = profile?.weeklyTarget;
  return t && t >= 1 && t <= 7 ? Math.round(t) : DEFAULT_WEEKLY_TARGET;
}

type Source = Pick<DB, "workouts" | "bookings" | "groups">;

/** Every moment this client trained (finished workout, attended session, attended class). */
export function activityMoments(db: Source, clientId: string): Date[] {
  const out: Date[] = [];
  for (const w of db.workouts) if (w.clientId === clientId && w.status === "DONE") out.push(parseISO(w.startedAt));
  for (const b of db.bookings) if (b.clientId === clientId && (b.status === "COMPLETED" || b.attendance?.mark === "PRESENT")) out.push(parseISO(b.start));
  for (const g of db.groups) if (attendedClass(g, clientId)) out.push(parseISO(g.start));
  return out;
}

/** Did this client attend the class? Coaches see the roster; a client sees only their own place. */
export function attendedClass(g: GroupSession, clientId: string): boolean {
  if (g.status === "CANCELLED") return false;
  const m = g.members?.find((x) => x.clientId === clientId);
  if (m) return m.status === "ATTENDED" || m.attendance?.mark === "PRESENT";
  return !g.members && g.mine?.attendance?.mark === "PRESENT";
}

/** Sessions the client did not show up to in the last `days` days (1-on-1 and class no-shows). */
export function recentNoShows(db: Source, clientId: string, now: Date, days = 7): { at: Date; what: string }[] {
  const since = now.getTime() - days * 86_400_000;
  const out: { at: Date; what: string }[] = [];
  const inRange = (iso: string) => {
    const t = parseISO(iso).getTime();
    return t >= since && t <= now.getTime();
  };
  for (const b of db.bookings) {
    if (b.clientId !== clientId || !inRange(b.start)) continue;
    if (b.status === "NO_SHOW" || b.attendance?.mark === "NO_SHOW") out.push({ at: parseISO(b.start), what: "1-on-1 session" });
  }
  for (const g of db.groups) {
    if (g.status === "CANCELLED" || !inRange(g.start)) continue;
    const m = g.members?.find((x) => x.clientId === clientId);
    const bad = m ? m.status === "ABSENT" || m.attendance?.mark === "NO_SHOW" : !g.members && g.mine?.attendance?.mark === "NO_SHOW";
    if (bad) out.push({ at: parseISO(g.start), what: g.title || "Class" });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Training days (yyyy-MM-dd) inside the last `windowDays` days, today included. */
export function daysInWindow(moments: Date[], now: Date, windowDays: number): Set<string> {
  const from = startOfDay(new Date(now.getTime() - (windowDays - 1) * 86_400_000)).getTime();
  const to = now.getTime();
  const set = new Set<string>();
  for (const m of moments) if (m.getTime() >= from && m.getTime() <= to) set.add(dayKey(m));
  return set;
}

/** Share of the weekly target reached over `windowDays` days, capped at 100. */
export function trainingPct(days: number, target: number, windowDays: number): number {
  const goal = (target * windowDays) / 7;
  if (goal <= 0) return 0;
  return Math.min(100, Math.round((days / goal) * 100));
}

/** Monday = 0 … Sunday = 6. */
const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;

/** Training days so far in the calendar week (Monday to Sunday) that `now` falls in, and days left in it (today included). */
export function thisWeek(moments: Date[], now: Date): { done: number; daysLeft: number } {
  const idx = weekdayIndex(now);
  const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - idx)).getTime();
  const set = new Set<string>();
  for (const m of moments) if (m.getTime() >= from && m.getTime() <= now.getTime()) set.add(dayKey(m));
  return { done: set.size, daysLeft: 7 - idx };
}

export interface ClientStatus {
  clientId: string;
  target: number;
  /** Share of the weekly target reached over the last 7 and 30 days (0-100). */
  pct7: number;
  pct30: number;
  weekDone: number;
  daysLeft: number;
  /** Needs every remaining day this week to reach the target. */
  behind: boolean;
  lastActivity: Date | null;
  /** Whole days since the last activity; null when there is none yet. */
  daysQuiet: number | null;
  quiet: boolean;
  noShows: { at: Date; what: string }[];
  lowCredits: boolean;
  /** Still on the first password for a few days. */
  notLoggedIn: boolean;
  /** Started training with this coach less than a week ago. */
  isNew: boolean;
  attention: boolean;
  reasons: string[];
}

/** Everything the Clients page and the dashboard need to know about one client. Archived clients never need attention. */
export function clientStatus(input: { user: User; profile: ClientProfile; db: Source & Pick<DB, "bookings">; now: Date }): ClientStatus {
  const { user, profile, db, now } = input;
  const id = user.id;
  const target = weeklyTargetOf(profile);
  const moments = activityMoments(db, id);
  const last = moments.length ? new Date(Math.max(...moments.map((m) => m.getTime()))) : null;
  const week = thisWeek(moments, now);
  const started = [profile.startDate, user.createdAt]
    .map((s) => (s ? parseISO(s) : null))
    .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const ageDays = started ? Math.max(0, differenceInCalendarDays(now, started)) : 999;
  const isNew = ageDays < NEW_CLIENT_DAYS;
  const daysQuiet = last ? Math.max(0, differenceInCalendarDays(now, last)) : null;
  const archived = profile.archived;

  const needed = Math.max(0, target - week.done);
  const behind = !archived && !isNew && needed > 0 && needed >= week.daysLeft;
  const quiet = !archived && !isNew && (daysQuiet === null || daysQuiet >= QUIET_DAYS);
  const noShows = archived ? [] : recentNoShows(db, id, now);
  const lowCredits = !archived && availableCredits(profile, db.bookings) <= LOW_CREDITS;
  const notLoggedIn = !archived && user.mustChangePassword && ageDays >= NO_LOGIN_FLAG_DAYS;

  const reasons: string[] = [];
  if (behind) reasons.push(`Behind: ${week.done} of ${target} this week`);
  if (quiet) reasons.push(daysQuiet === null ? "Nothing logged yet" : `Quiet for ${daysQuiet} days`);
  if (noShows.length) reasons.push(noShows.length === 1 ? `No-show ${format(noShows[0].at, "EEE")}` : `${noShows.length} no-shows this week`);
  if (lowCredits) reasons.push("Low on credits");
  if (notLoggedIn) reasons.push("Hasn't logged in yet");

  return {
    clientId: id,
    target,
    pct7: trainingPct(daysInWindow(moments, now, 7).size, target, 7),
    pct30: trainingPct(daysInWindow(moments, now, 30).size, target, 30),
    weekDone: week.done,
    daysLeft: week.daysLeft,
    behind,
    lastActivity: last,
    daysQuiet,
    quiet,
    noShows,
    lowCredits,
    notLoggedIn,
    isNew,
    attention: behind || quiet || noShows.length > 0 || lowCredits || notLoggedIn,
    reasons,
  };
}

export type AttentionGroup = "all" | "attention" | "behind" | "quiet" | "low" | "nologin";

export const GROUP_LABEL: Record<AttentionGroup, string> = {
  all: "All",
  attention: "Needs attention",
  behind: "Behind target",
  quiet: "Quiet 7+ days",
  low: "Low credits",
  nologin: "Not logged in",
};

export function inGroup(s: ClientStatus, g: AttentionGroup): boolean {
  switch (g) {
    case "attention":
      return s.attention;
    case "behind":
      return s.behind;
    case "quiet":
      return s.quiet;
    case "low":
      return s.lowCredits;
    case "nologin":
      return s.notLoggedIn;
    default:
      return true;
  }
}

/** Colour for a training percentage: green on track, amber slipping, red well behind. */
export function pctTone(pct: number): "success" | "warn" | "danger" {
  return pct >= 80 ? "success" : pct >= 50 ? "warn" : "danger";
}

/** The Monday-to-Sunday "behind" / "quiet" / "no-show" lists the nudge panel shows. */
export interface NudgeLists {
  noShow: ClientStatus[];
  behind: ClientStatus[];
  quiet: ClientStatus[];
}

export function nudgeLists(statuses: ClientStatus[]): NudgeLists {
  return {
    noShow: statuses.filter((s) => s.noShows.length > 0),
    behind: statuses.filter((s) => s.behind),
    quiet: statuses.filter((s) => s.quiet),
  };
}

/** Distinct client ids across the lists, in one pass. */
export function nudgeIds(lists: NudgeLists): string[] {
  return [...new Set([...lists.noShow, ...lists.behind, ...lists.quiet].map((s) => s.clientId))];
}
