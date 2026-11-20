/*
 * Business dashboard helpers (pure: no database, shared by the server queries, the page and the tests).
 * Months are "YYYY-MM" in Singapore time (or APP_TZ), the same way the rest of the app counts days.
 */

/** The last `n` months ending with the month of `today` (yyyy-MM-dd), oldest first: ["2026-06", ..., "2026-11"]. */
export function lastMonths(n: number, today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    const yy = Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    out.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return out;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11" to "Nov". */
export const monthShort = (key: string): string => MONTH_NAMES[Number(key.slice(5, 7)) - 1] ?? key;

/** Percent change from `prev` to `cur`, rounded; null when there is nothing to compare against. */
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Puts database rows (some months may be missing) onto the full list of months, filling gaps with zero. */
export function onMonths<T extends { month: string }>(months: string[], rows: T[], zero: Omit<T, "month">): T[] {
  const by = new Map(rows.map((r) => [r.month, r]));
  return months.map((m) => by.get(m) ?? ({ month: m, ...zero } as T));
}

/** A weekday (0 = Sunday) or hour histogram from database rows. */
export function histogram(size: number, rows: { slot: number; n: number }[]): number[] {
  const out = new Array<number>(size).fill(0);
  for (const r of rows) if (Number.isInteger(r.slot) && r.slot >= 0 && r.slot < size) out[r.slot] += r.n;
  return out;
}

/** The index of the largest value, or -1 when everything is zero. */
export const peakIndex = (xs: number[]): number => {
  let best = -1;
  let max = 0;
  xs.forEach((x, i) => {
    if (x > max) {
      max = x;
      best = i;
    }
  });
  return best;
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const hourLabel = (h: number): string => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

/** Whole percent of `part` in `whole`, or null for an empty whole. */
export const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** Whole days between an instant and now (never negative). */
export const daysSince = (then: Date, now: Date): number => Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));

/** Clients to look at first: no completed session for a while (and not brand new). */
export const AT_RISK_DAYS = 21;
export const NEW_CLIENT_GRACE_DAYS = 14;
export function isAtRisk(lastSession: Date | null, clientSince: Date, now: Date): boolean {
  if (daysSince(clientSince, now) < NEW_CLIENT_GRACE_DAYS) return false;
  return lastSession === null || daysSince(lastSession, now) >= AT_RISK_DAYS;
}

/* ===================== Class occupancy and coach performance ===================== */

const DAY_MS = 86_400_000;

/** The Singapore weekday (0 = Sunday), hour and month of an instant, for grouping classes by when they are held. */
export function localParts(when: Date, tz = "Asia/Singapore"): { weekday: number; hour: number; month: string } {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit" }).formatToParts(when);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday: weekday < 0 ? 0 : weekday, hour: Number(get("hour")) || 0, month: `${get("year")}-${get("month")}` };
}

/** One class that has been held (or is past its start): its place in the week, its size and who came. */
export interface ClassRow {
  id: string;
  title: string;
  weekday: number;
  hour: number;
  month: string;
  /** Start time, epoch milliseconds. */
  t: number;
  capacity: number;
  /** People who had a place (confirmed, attended or absent). */
  booked: number;
  attended: number;
  absent: number;
}
export interface ClassEventRow {
  groupId: string;
  kind: "WAITLIST" | "CANCEL" | "LATE_CANCEL";
}

/** A recurring class slot: the same title at the same weekday and hour. */
export interface SlotStat {
  key: string;
  title: string;
  weekday: number;
  hour: number;
  sessions: number;
  avgCapacity: number;
  avgBooked: number;
  fillPct: number | null;
  attendedPct: number | null;
  noShowPct: number | null;
  waitlistJoins: number;
  /** The last 8 weeks, and the last 4 against the 4 before, to see which way a class is going. */
  sessions8w: number;
  fill8w: number | null;
  nRecent: number;
  fillRecent: number | null;
  nPrev: number;
  fillPrev: number | null;
}

export interface OccupancySummary {
  trend: { month: string; classes: number; fillPct: number | null; attendedPct: number | null }[];
  byClass: SlotStat[];
  /** weekday (0 = Sunday) and hour: how full classes were then, and how many were held (last 90 days). */
  heatmap: { weekday: number; hour: number; fillPct: number | null; classes: number }[];
  totals: { classes: number; fillPct: number | null; noShowPct: number | null; fullClasses: number; waitlistJoins: number; cancels: number; lateCancels: number };
  suggestions: Suggestion[];
}

export interface Suggestion {
  key: string;
  kind: "full" | "underfilled" | "falling" | "noshows";
  title: string;
  detail: string;
}

const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const ratio = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 100) : null);
const r1 = (n: number) => Math.round(n * 10) / 10;
export const slotKey = (title: string, weekday: number, hour: number): string => `${title.trim().toLowerCase()}|${weekday}|${hour}`;
export const slotLabel = (s: { title: string; weekday: number; hour: number }): string => `${s.title} (${WEEKDAYS[s.weekday]} ${hourLabel(s.hour)})`;

/** Fill % of a set of classes: places taken out of places there were. */
const fillOf = (rows: ClassRow[]): number | null => ratio(sumOf(rows.map((r) => r.booked)), sumOf(rows.map((r) => r.capacity)));
/** Who actually came, counted only for classes the coach has marked (finished). */
const marked = (rows: ClassRow[]) => rows.filter((r) => r.attended + r.absent > 0);

/**
 * Class occupancy from the classes held in the last ~200 days: fill by recurring class, a weekday-by-hour heatmap, a month-by-month trend,
 * totals, and plain-words suggestions. Pure: pass the rows and "now".
 */
export function summariseClasses(rows: ClassRow[], events: ClassEventRow[], months: string[], now: number): OccupancySummary {
  const day90 = now - 90 * DAY_MS;
  const w8 = now - 56 * DAY_MS;
  const w4 = now - 28 * DAY_MS;
  const recent90 = rows.filter((r) => r.t >= day90 && r.t <= now);

  const trend = months.map((m) => {
    const inM = rows.filter((r) => r.month === m && r.t <= now);
    const done = marked(inM);
    return { month: m, classes: inM.length, fillPct: fillOf(inM), attendedPct: ratio(sumOf(done.map((r) => r.attended)), sumOf(done.map((r) => r.capacity))) };
  });

  const idsInView = new Set(recent90.map((r) => r.id));
  const waitBy = new Map<string, number>();
  for (const e of events) if (e.kind === "WAITLIST" && idsInView.has(e.groupId)) waitBy.set(e.groupId, (waitBy.get(e.groupId) ?? 0) + 1);

  const groups = new Map<string, ClassRow[]>();
  for (const r of recent90) {
    const k = slotKey(r.title, r.weekday, r.hour);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  const byClass: SlotStat[] = [...groups.entries()].map(([key, rs]) => {
    const sorted = [...rs].sort((a, b) => b.t - a.t);
    const done = marked(rs);
    const in8 = rs.filter((r) => r.t >= w8);
    const recent = rs.filter((r) => r.t >= w4);
    const prev = rs.filter((r) => r.t >= w8 && r.t < w4);
    return {
      key,
      title: sorted[0].title,
      weekday: sorted[0].weekday,
      hour: sorted[0].hour,
      sessions: rs.length,
      avgCapacity: r1(sumOf(rs.map((r) => r.capacity)) / rs.length),
      avgBooked: r1(sumOf(rs.map((r) => r.booked)) / rs.length),
      fillPct: fillOf(rs),
      attendedPct: ratio(sumOf(done.map((r) => r.attended)), sumOf(done.map((r) => r.capacity))),
      noShowPct: ratio(sumOf(done.map((r) => r.absent)), sumOf(done.map((r) => r.attended + r.absent))),
      waitlistJoins: sumOf(rs.map((r) => waitBy.get(r.id) ?? 0)),
      sessions8w: in8.length,
      fill8w: fillOf(in8),
      nRecent: recent.length,
      fillRecent: fillOf(recent),
      nPrev: prev.length,
      fillPrev: fillOf(prev),
    };
  });
  byClass.sort((a, b) => (b.fillPct ?? -1) - (a.fillPct ?? -1) || b.sessions - a.sessions || a.title.localeCompare(b.title));

  const cells = new Map<string, ClassRow[]>();
  for (const r of recent90) {
    const k = `${r.weekday}|${r.hour}`;
    const list = cells.get(k) ?? [];
    list.push(r);
    cells.set(k, list);
  }
  const heatmap = [...cells.entries()].map(([k, rs]) => {
    const [weekday, hour] = k.split("|").map(Number);
    return { weekday, hour, fillPct: fillOf(rs), classes: rs.length };
  });

  const done90 = marked(recent90);
  const totals = {
    classes: recent90.length,
    fillPct: fillOf(recent90),
    noShowPct: ratio(sumOf(done90.map((r) => r.absent)), sumOf(done90.map((r) => r.attended + r.absent))),
    fullClasses: recent90.filter((r) => r.capacity > 0 && r.booked >= r.capacity).length,
    waitlistJoins: events.filter((e) => e.kind === "WAITLIST").length,
    cancels: events.filter((e) => e.kind === "CANCEL" || e.kind === "LATE_CANCEL").length,
    lateCancels: events.filter((e) => e.kind === "LATE_CANCEL").length,
  };
  return { trend, byClass, heatmap, totals, suggestions: classSuggestions(byClass) };
}

/** Plain-words suggestions from how each recurring class is doing. At most 6, the most useful first. */
export function classSuggestions(byClass: SlotStat[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const s of byClass) {
    const label = slotLabel(s);
    if (s.fill8w !== null && s.fill8w >= 90 && s.waitlistJoins >= 3 && s.sessions8w >= 3) {
      out.push({ key: `${s.key}|full`, kind: "full", title: `${label} is nearly always full`, detail: `It averaged ${s.fill8w}% full over ${s.sessions8w} sessions and ${s.waitlistJoins} people joined the waitlist. Consider a second session at a nearby time, or more places.` });
    }
    if (s.fill8w !== null && s.fill8w < 35 && s.sessions8w >= 4) {
      out.push({ key: `${s.key}|under`, kind: "underfilled", title: `${label} is under 35% full`, detail: `It averaged ${s.fill8w}% over ${s.sessions8w} sessions in 8 weeks. Consider moving it to a busier time, or merging it with another class.` });
    }
    if (s.fillRecent !== null && s.fillPrev !== null && s.nRecent >= 3 && s.nPrev >= 3 && s.fillRecent <= s.fillPrev - 15) {
      out.push({ key: `${s.key}|falling`, kind: "falling", title: `${label} is filling less`, detail: `It fell from ${s.fillPrev}% to ${s.fillRecent}% over the last four weeks. A reminder to members, or a fresh workout, may help.` });
    }
    if (s.noShowPct !== null && s.noShowPct >= 20 && s.avgBooked * s.sessions >= 10) {
      out.push({ key: `${s.key}|noshow`, kind: "noshows", title: `${label} has many no-shows`, detail: `${s.noShowPct}% of the people who booked did not come. A reminder the day before usually helps.` });
    }
  }
  const order: Record<Suggestion["kind"], number> = { full: 0, underfilled: 1, falling: 2, noshows: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 6);
}

/* ---------------- Retention ---------------- */
export interface RetClient {
  /** When they became this coach's client, epoch ms. */
  since: number;
  active: boolean;
  /** Their latest completed session or class, epoch ms. */
  last: number | null;
}
export interface Retention {
  cohort: number;
  kept: number;
  pct: number | null;
}
/** Below this many clients in a group, a percentage says little, so none is shown. */
export const MIN_COHORT = 3;

/** Of the clients who started at least `months` months ago, how many still trained in the last 30 days. */
export function retention(clients: RetClient[], now: number, months: number): Retention {
  const cutoff = now - months * 30 * DAY_MS;
  const cohort = clients.filter((c) => c.since <= cutoff);
  const kept = cohort.filter((c) => c.active && c.last !== null && now - c.last <= 30 * DAY_MS).length;
  return { cohort: cohort.length, kept, pct: cohort.length >= MIN_COHORT ? ratio(kept, cohort.length) : null };
}

/* ---------------- CSV ---------------- */
/** One CSV cell. Text that a spreadsheet could read as a formula (=, +, -, @) gets a leading apostrophe so it stays text. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = (rows: (string | number | null | undefined)[][]): string => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/* ---------------- Coach performance ---------------- */
/** One coach's numbers. Counts and percentages only: never a client's name, health detail or payment. */
export interface CoachPerf {
  id: string;
  name: string;
  /** Active clients now. */
  clients: number;
  sessions30: number;
  sessionsPrev30: number;
  hours30: number;
  classes30: number;
  /** How full their classes were over 30 days, and how many people came to them. */
  classFillPct: number | null;
  classAttendees30: number;
  /** Present against no-show, 90 days (1-on-1 and classes). */
  attendancePct: number | null;
  noShows90: number;
  /** Cancelled 1-on-1 sessions against everything that was booked, 90 days. */
  cancelPct: number | null;
  cancels90: number;
  retention: { m1: Retention; m3: Retention; m6: Retention };
  /** Workouts logged per active client per week (last 4 weeks), and the share of active clients with one in the last 2 weeks. */
  workoutsPerClientWeek: number | null;
  engagedPct: number | null;
}

const pctText = (n: number | null) => (n === null ? "" : n);
const retText = (r: Retention) => (r.pct === null ? "" : r.pct);

/** The coach performance table as a CSV (one row per coach). */
export function performanceCsv(rows: CoachPerf[]): string {
  return toCsv([
    ["Coach", "Active clients", "Sessions (30 days)", "Sessions (previous 30 days)", "Hours (30 days)", "Classes (30 days)", "Class fill %", "Class attendees (30 days)", "Attendance %", "No-shows (90 days)", "Cancelled % (90 days)", "Retention 1 month %", "Retention 3 months %", "Retention 6 months %", "Workouts per client per week", "Clients with a workout in 2 weeks %"],
    ...rows.map((p) => [p.name, p.clients, p.sessions30, p.sessionsPrev30, p.hours30, p.classes30, pctText(p.classFillPct), p.classAttendees30, pctText(p.attendancePct), p.noShows90, pctText(p.cancelPct), retText(p.retention.m1), retText(p.retention.m3), retText(p.retention.m6), p.workoutsPerClientWeek ?? "", pctText(p.engagedPct)]),
  ]);
}

/** Fill by recurring class (last 90 days) as a CSV. */
export function classesCsv(byClass: SlotStat[]): string {
  return toCsv([
    ["Class", "Day", "Hour", "Sessions (90 days)", "Average places", "Average booked", "Fill %", "Attended %", "No-show %", "Waitlist joins"],
    ...byClass.map((s) => [s.title, WEEKDAYS[s.weekday], hourLabel(s.hour), s.sessions, s.avgCapacity, s.avgBooked, pctText(s.fillPct), pctText(s.attendedPct), pctText(s.noShowPct), s.waitlistJoins]),
  ]);
}
