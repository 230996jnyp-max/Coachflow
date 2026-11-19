/*
 * Referrals, the rules (pure, shared by the server, the sign-up form and the tests). Three kinds, by who invites:
 *  - COACH  a coach invites another coach. The new coach starts with a longer free trial (a free month). When they become a paying
 *           subscriber, the coach who invited them gets one month free.
 *  - CLIENT a client invites a friend to train with the same coach. When the coach accepts the friend, the client earns session credits
 *           (as many as that coach has set; 0 = rewards off).
 *  - SOLO   someone training on their own invites a friend. The friend starts with a longer free trial, and the inviter gets the same
 *           bonus once the friend has confirmed their email.
 * A code only works for its own kind of sign-up, and each kind has a cap on how many rewards one person can earn.
 */

export type ReferralKind = "COACH" | "CLIENT" | "SOLO";

/** Free days a new coach or solo user gets on top of the normal trial when they sign up with a code. */
export const REFERRAL_BONUS_DAYS = 30;
/** Free days a solo user earns when a friend they invited confirms their account. */
export const SOLO_REWARD_DAYS = 30;
/** The most rewards one person can earn, by kind. */
export const REFERRAL_CAPS: Record<ReferralKind, number> = { COACH: 12, CLIENT: 5, SOLO: 6 };
export const REFERRAL_MAX_REWARDS = REFERRAL_CAPS.COACH;
/** The most session credits a coach can offer per friend a client brings. */
export const MAX_CLIENT_REWARD_CREDITS = 3;

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

/** The sign-up role a link opens (?role=...). */
const LINK_ROLE: Record<ReferralKind, string> = { COACH: "coach", CLIENT: "client", SOLO: "personal" };

export const referralLink = (origin: string, code: string, kind: ReferralKind = "COACH"): string => `${origin.replace(/\/$/, "")}/signup?role=${LINK_ROLE[kind]}&ref=${encodeURIComponent(code)}`;

/** Which kind of code a sign-up can use: coaches and gyms use coach codes, clients use client codes, solo accounts use solo codes. */
export const kindForSignupRole = (role: string): ReferralKind => (role === "CLIENT" ? "CLIENT" : role === "PERSONAL" ? "SOLO" : "COACH");

/** What to tell someone who typed a code made for a different kind of sign-up. */
export function mismatchMessage(codeKind: ReferralKind, role: string): string {
  const mine = kindForSignupRole(role);
  if (codeKind === mine) return "";
  const from = codeKind === "COACH" ? "a coach, for inviting other coaches" : codeKind === "CLIENT" ? "a client, for inviting a friend to their coach" : "someone training on their own, for inviting friends who train on their own";
  const use = mine === "COACH" ? "to sign up as a coach" : mine === "CLIENT" ? "to join a coach. Use your coach's 6-digit code instead, or the link a client of that coach gives you" : "when you train on your own. Ask for a link from someone who trains on their own, or leave it blank";
  return `That referral code is from ${from}, so it can't be used ${use}.`;
}

export type ReferralStatus = "SIGNED_UP" | "JOINED" | "PAID" | "REWARDED" | "CAPPED";

/** The small badge on each person someone invited. */
export function statusLabel(status: string, kind: ReferralKind): string {
  switch (status) {
    case "SIGNED_UP":
      return "Signed up";
    case "JOINED":
      return "Joined";
    case "PAID":
      return "Subscribed";
    case "REWARDED":
      return kind === "COACH" ? "Free month earned" : kind === "CLIENT" ? "Free session earned" : "30 days earned";
    case "CAPPED":
      return "Limit reached";
    default:
      return status;
  }
}

/** One line for the person who invited: what is happening with someone they invited. */
export function referralStatusText(status: string, firstName: string, kind: ReferralKind = "COACH"): string {
  const cap = REFERRAL_CAPS[kind];
  if (kind === "CLIENT") {
    switch (status) {
      case "SIGNED_UP":
        return `${firstName} signed up. Your coach still has to accept them.`;
      case "JOINED":
        return `${firstName} joined your coach. Your coach hasn't switched on referral rewards, so nothing was added.`;
      case "REWARDED":
        return `${firstName} joined. You earned a free session.`;
      case "CAPPED":
        return `${firstName} joined. You have reached the limit of ${cap} free sessions this way.`;
      default:
        return `${firstName} signed up.`;
    }
  }
  if (kind === "SOLO") {
    switch (status) {
      case "SIGNED_UP":
        return `${firstName} signed up. Your ${SOLO_REWARD_DAYS} days arrive when they confirm their email.`;
      case "JOINED":
        return `${firstName} joined.`;
      case "REWARDED":
        return `${firstName} joined. Your free trial is ${SOLO_REWARD_DAYS} days longer.`;
      case "CAPPED":
        return `${firstName} joined. You have reached the limit of ${cap} bonus months.`;
      default:
        return `${firstName} signed up.`;
    }
  }
  switch (status) {
    case "SIGNED_UP":
      return `${firstName} signed up. Your free month arrives when they subscribe.`;
    case "PAID":
      return `${firstName} subscribed. Your free month is being applied.`;
    case "REWARDED":
      return `${firstName} subscribed. You got a free month.`;
    case "CAPPED":
      return `${firstName} subscribed. You have reached the limit of ${cap} free months.`;
    default:
      return `${firstName} signed up.`;
  }
}
