/*
 * Coach referrals, the rules (pure, shared by the server, the sign-up form and the tests).
 *  - Every coach has a code (CF-XXXXXX) and a link. A new coach who signs up with it gets a longer free trial straight away.
 *  - When that new coach becomes a paying subscriber, the coach who invited them gets one month free.
 *  - A coach can earn at most REFERRAL_MAX_REWARDS free months this way.
 */

export const REFERRAL_BONUS_DAYS = 30;
export const REFERRAL_MAX_REWARDS = 12;

/** No 0/O/1/I/L: nobody mistypes a code read out loud or from a screenshot. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_RE = /^CF[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

/** Makes a fresh code from random bytes (6 characters after "CF"). */
export function makeReferralCode(random: (n: number) => Uint8Array): string {
  const bytes = random(6);
  let out = "CF";
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** What a person typed (any case, with or without the dash or spaces) as the stored form, or null when it is not a code. */
export function cleanReferralCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.toUpperCase().replace(/[\s-]/g, "");
  return CODE_RE.test(s) ? s : null;
}

/** CF7K4Q9P to CF-7K4Q9P, for showing. */
export const showReferralCode = (code: string): string => (code.length === 8 ? `${code.slice(0, 2)}-${code.slice(2)}` : code);

export const referralLink = (origin: string, code: string): string => `${origin.replace(/\/$/, "")}/signup?role=coach&ref=${encodeURIComponent(code)}`;

export type ReferralStatus = "SIGNED_UP" | "PAID" | "REWARDED" | "CAPPED";

/** One line for the referrer: what is happening with a coach they invited. */
export function referralStatusText(status: string, firstName: string): string {
  switch (status) {
    case "SIGNED_UP":
      return `${firstName} signed up. Your free month arrives when they subscribe.`;
    case "PAID":
      return `${firstName} subscribed. Your free month is being applied.`;
    case "REWARDED":
      return `${firstName} subscribed. You got a free month.`;
    case "CAPPED":
      return `${firstName} subscribed. You have reached the limit of ${REFERRAL_MAX_REWARDS} free months.`;
    default:
      return `${firstName} signed up.`;
  }
}
