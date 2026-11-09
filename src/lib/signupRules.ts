/*
 * Rules shared by the sign-up screen and the server (pure: no database, no browser). The server checks everything again; the screen
 * uses these only to tell people what is wrong before they press the button.
 */

export const MIN_AGE = 13;
export const ADULT_AGE = 18;
export const TRIAL_DAYS = 30;

export type SignupRole = "COACH" | "CLIENT" | "PERSONAL";
export const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;
export type Level = (typeof LEVELS)[number];
export const WEEKLY_TARGETS = [2, 3, 4, 5, 6] as const; // 6 means "6 or more"
export const PERSONAL_GOALS = ["Build Strength", "Improve Sport Performance", "Mobility & Longevity", "Body Recomposition"] as const;
/** The goals a coach can give a client (the same list as a coach-made client). */
export const CLIENT_GOALS = ["Hypertrophy", "Fat Loss", "Strength", "Conditioning", "General Fitness"] as const;

/** A birth date typed as YYYY-MM-DD: the real calendar date, or null. */
export function parseDob(v: unknown): { iso: string; y: number; m: number; d: number } | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { iso: `${m[1]}-${m[2]}-${m[3]}`, y, m: mo, d };
}

/** Whole years old on `now` (Singapore time is close enough: birthdays move by hours, not days). Null when the date isn't real or is in the future. */
export function ageOn(dob: unknown, now: Date = new Date()): number | null {
  const p = parseDob(dob);
  if (!p) return null;
  let age = now.getUTCFullYear() - p.y;
  const beforeBirthday = now.getUTCMonth() + 1 < p.m || (now.getUTCMonth() + 1 === p.m && now.getUTCDate() < p.d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

/** Under 18: no calorie targets and no AI features. Unknown ages (coach-made clients, staff) count as adults. */
export const isMinorAge = (age: number | null): boolean => age !== null && age < ADULT_AGE;

export type AgeCheck = { ok: true; age: number; minor: boolean; needsGuardian: boolean } | { ok: false; error: string };

/** 13+ may join; 13 to 17 also need to confirm a parent or guardian agrees. */
export function checkAge(dob: unknown, now: Date = new Date()): AgeCheck {
  const age = ageOn(dob, now);
  if (age === null) return { ok: false, error: "Enter your date of birth as a real date." };
  if (age < MIN_AGE) return { ok: false, error: `CoachFlow is for people ${MIN_AGE} and over.` };
  return { ok: true, age, minor: age < ADULT_AGE, needsGuardian: age < ADULT_AGE };
}

/* Throwaway-mailbox providers: an address there can't be reached later, so it can't be used to sign up. Not a complete list. */
const DISPOSABLE = new Set(
  (
    "mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org sharklasers.com grr.la 10minutemail.com 10minutemail.net " +
    "temp-mail.org tempmail.com tempmail.net tempmailo.com tempail.com throwawaymail.com yopmail.com yopmail.net yopmail.fr " +
    "trashmail.com trashmail.net trashmail.de dispostable.com getnada.com nada.email maildrop.cc mailnesia.com mintemail.com " +
    "fakeinbox.com spam4.me spambox.us spamgourmet.com mytemp.email moakt.com emailondeck.com burnermail.io discard.email " +
    "mohmal.com tmail.ws tmpmail.org tmpmail.net harakirimail.com mailcatch.com getairmail.com anonbox.net inboxkitten.com " +
    "33mail.com jetable.org mailforspam.com spamhere.com byom.de emltmp.com mail.tm 1secmail.com 1secmail.net 1secmail.org " +
    "luxusmail.org cool.fr.nf nospam.ze.tc jourrapide.com armyspy.com cuvox.de dayrep.com einrot.com fleckens.hu gustr.com rhyta.com superrito.com teleworm.us"
  ).split(" "),
);
export function isDisposableEmail(address: string): boolean {
  const at = address.lastIndexOf("@");
  if (at < 0) return false;
  const host = address.slice(at + 1).trim().toLowerCase();
  return DISPOSABLE.has(host) || [...DISPOSABLE].some((d) => host.endsWith("." + d));
}

/** The six digits typed or pasted, ignoring spaces and dashes. Null unless it is exactly six digits. */
export function cleanCoachCode(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(/[\s-]/g, "");
  return /^\d{6}$/.test(s) ? s : null;
}

/** "Darsh Chan" -> "Darsh C." A coach's name as shown to someone who has only typed a code (not the full name). */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Coach";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** "Coach Darsh C." for "Darsh C.", but a name that already starts with "Coach" is left alone (no "Coach Coach O."). */
export const coachTitle = (name: string): string => (/^coach(\s|$)/i.test(name.trim()) ? name.trim() : `Coach ${name.trim()}`);

/** Whole days left of a trial (0 = ends today or already over). Null when there is no trial. */
export function trialDaysLeft(endsAt: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!endsAt) return null;
  const end = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}
export const trialOver = (endsAt: string | Date | null | undefined, now: Date = new Date()): boolean => {
  if (!endsAt) return false;
  const end = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  return !Number.isNaN(end.getTime()) && end.getTime() <= now.getTime();
};
