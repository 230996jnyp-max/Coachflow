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
