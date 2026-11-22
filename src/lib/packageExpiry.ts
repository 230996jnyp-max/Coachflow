/*
 * Package end dates (yyyy-MM-dd), shared by the daily alert job and its tests. Pure: no database, no server-only code.
 */

const dayNumber = (isoDate: string): number => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);

/** Today's date in the coach's country (Singapore unless APP_TZ says otherwise), as yyyy-MM-dd. */
export function todayIn(tz = "Asia/Singapore", now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from `today` to `expires` (both yyyy-MM-dd); 0 = ends today, negative = already over. */
export const daysUntil = (expires: string, today: string): number => dayNumber(expires) - dayNumber(today);

/** The number of days before the end that trigger a notice. */
export const EXPIRY_WARN_DAYS: readonly number[] = [7, 1];

/** The wording of "ends in" for a notice, or null when this day does not trigger one. */
export function expiryWhen(daysLeft: number): string | null {
  if (!EXPIRY_WARN_DAYS.includes(daysLeft)) return null;
  return daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
}
