/*
 * Consult a trainer: someone training on their own pays S$50 for one hour on a video call with a CoachFlow trainer. The first trainer
 * who accepts takes it. S$35 goes to the trainer (paid 48 hours after the consult, unless it is reported) and S$15 to CoachFlow, which
 * also pays the card fee. Pure rules only (no database), shared by the server and the screens.
 */

export const CONSULT_PRICE_CENTS = 5000;
export const CONSULT_TRAINER_CENTS = 3500;
export const CONSULT_MINUTES = 60;
/** With no trainer by then, the card hold is released (the person is never charged). */
export const ACCEPT_WINDOW_MIN = 30;
/** The trainer's share is sent this long after the consult ends, so a report can still be dealt with first. */
export const PAYOUT_DELAY_HOURS = 48;
/** The call screen warns both people this many minutes before the hour is up. (A report can be made until the trainer is paid.) */
export const WARN_BEFORE_END_MIN = 5;

export type ConsultStatus = "PAYING" | "OPEN" | "LIVE" | "DONE" | "EXPIRED" | "CANCELLED";
export type PayoutStatus = "NONE" | "HELD" | "PAID" | "CANCELLED";

export const money = (cents: number) => `S$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/** The trainer's share of what was kept after a refund (70%, so a S$50 consult pays S$35). */
export function trainerShare(keptCents: number): number {
  return Math.max(0, Math.round((keptCents * CONSULT_TRAINER_CENTS) / CONSULT_PRICE_CENTS));
}

/* ---------------- Reports ---------------- */
export type ReporterRole = "SOLO" | "TRAINER";
export const REPORT_REASONS = {
  SOLO: [
    { id: "no_show", label: "The trainer didn't turn up" },
    { id: "ended_early", label: "It ended early or was cut short" },
    { id: "unhelpful", label: "The advice wasn't helpful" },
    { id: "unsafe", label: "The advice seemed unsafe" },
    { id: "inappropriate", label: "The trainer was rude or inappropriate" },
    { id: "technical", label: "The call didn't work" },
    { id: "other", label: "Something else" },
  ],
  TRAINER: [
    { id: "no_show", label: "They didn't turn up" },
    { id: "abusive", label: "They were rude, abusive or inappropriate" },
    { id: "technical", label: "The call didn't work" },
    { id: "other", label: "Something else" },
  ],
} as const;
export type ReportReason = (typeof REPORT_REASONS)[ReporterRole][number]["id"];

export function isReason(role: ReporterRole, v: unknown): v is ReportReason {
  return typeof v === "string" && REPORT_REASONS[role].some((r) => r.id === v);
}
export const reasonLabel = (role: ReporterRole, id: string) => REPORT_REASONS[role].find((r) => r.id === id)?.label ?? id;

export type RefundChoice = "none" | "partial" | "full";
export type Sanction = "none" | "warn_trainer" | "suspend_trainer" | "warn_person" | "block_person";

/** What happened in the consult, as the app saw it: who opened the call, and for how long it ran. */
export interface ConsultFacts {
  trainerJoined: boolean;
  personJoined: boolean;
  /** Minutes from the trainer accepting to the consult ending (60 when it ran its course). */
  minutes: number;
  /** Who ended it early, if anyone did. */
  endedBy: "SOLO" | "TRAINER" | null;
  /** Earlier reports against this trainer that the owner upheld (refund or sanction), and the same for the person. */
  trainerUpheld: number;
  personUpheld: number;
}

export interface Recommendation {
  refund: RefundChoice;
  /** For a partial refund. */
  refundCents: number;
  sanction: Sanction;
  /** One or two plain sentences on why. */
  why: string;
}

/**
 * What the owner is advised to do with a report. It is advice only: the owner decides. The rules lean towards refunding the person when
 * the app's own record backs them up (the trainer never opened the call, it was cut short), and towards paying the trainer when the
 * person didn't turn up or behaved badly. Repeat problems move a warning up to a suspension.
 */
const mins = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;

export function recommend(role: ReporterRole, reason: string, f: ConsultFacts): Recommendation {
  const repeatTrainer = f.trainerUpheld >= 2;
  const repeatPerson = f.personUpheld >= 1;
  if (role === "SOLO") {
    switch (reason) {
      case "no_show":
        return f.trainerJoined
          ? { refund: "partial", refundCents: 2500, sanction: "none", why: "The app shows the trainer did open the call, so it may have been a missed connection. Ask both sides; a half refund is fair if they never met." }
          : { refund: "full", refundCents: 0, sanction: repeatTrainer ? "suspend_trainer" : "warn_trainer", why: `The trainer never opened the call. Refund in full and ${repeatTrainer ? "suspend them from consults (this has happened before)" : "warn the trainer"}.` };
      case "ended_early":
        if (f.minutes < 30 && f.endedBy !== "SOLO") return { refund: "partial", refundCents: 2500, sanction: repeatTrainer ? "warn_trainer" : "none", why: `It lasted about ${mins(f.minutes)} and the person didn't end it. Refund half.` };
        return { refund: "none", refundCents: 0, sanction: "none", why: f.endedBy === "SOLO" ? "The person ended the call themselves. No refund is due." : `It ran for about ${mins(f.minutes)}, most of the hour. Pay the trainer.` };
      case "unhelpful":
        if (!f.personJoined || f.minutes < 15)
          return { refund: "partial", refundCents: 2500, sanction: "none", why: `The call only ran about ${mins(f.minutes)}${f.personJoined ? "" : " and the person never opened it"}, so it's too early to judge the advice. Ask what happened; half back is fair if they never really talked.` };
        return { refund: "none", refundCents: 0, sanction: repeatTrainer ? "warn_trainer" : "none", why: `Advice quality is a matter of opinion and the trainer gave their time (${mins(f.minutes)}). Pay the trainer; ${repeatTrainer ? "this trainer has had upheld reports before, so send a warning." : "reply to the person kindly."}` };
      case "unsafe":
        return { refund: "full", refundCents: 0, sanction: repeatTrainer ? "suspend_trainer" : "warn_trainer", why: "Safety comes first. Refund in full, tell the person to stop anything that hurts and see a doctor if needed, and look at what the trainer said." };
      case "inappropriate":
        return { refund: "full", refundCents: 0, sanction: "suspend_trainer", why: "Rude or inappropriate behaviour. Refund in full and suspend the trainer from consults while you talk to them." };
      case "technical":
        return f.minutes < 15 || !f.trainerJoined || !f.personJoined
          ? { refund: "full", refundCents: 0, sanction: "none", why: "The call barely happened. Refund in full; nobody is at fault." }
          : { refund: "partial", refundCents: 2500, sanction: "none", why: `They were connected for about ${mins(f.minutes)} before it failed. Refund half.` };
      default:
        return { refund: "none", refundCents: 0, sanction: "none", why: "Read the details and decide; nothing in the app's record points one way." };
    }
  }
  switch (reason) {
    case "no_show":
      return f.personJoined
        ? { refund: "none", refundCents: 0, sanction: "none", why: "The app shows the person did open the call. Pay the trainer and ask both what happened." }
        : { refund: "none", refundCents: 0, sanction: "none", why: "The person booked and didn't turn up. Pay the trainer for the hour they kept free." };
    case "abusive":
      return { refund: "none", refundCents: 0, sanction: repeatPerson ? "block_person" : "warn_person", why: `Pay the trainer and ${repeatPerson ? "block the person from consults (this has happened before)" : "warn the person"}.` };
    case "technical":
      return f.minutes < 15 ? { refund: "full", refundCents: 0, sanction: "none", why: "The call barely happened. Refund the person; the trainer isn't paid for this one." } : { refund: "none", refundCents: 0, sanction: "none", why: "Most of the hour happened. Pay the trainer." };
    default:
      return { refund: "none", refundCents: 0, sanction: "none", why: "Read the details and decide." };
  }
}

export const SANCTION_LABEL: Record<Sanction, string> = {
  none: "No action",
  warn_trainer: "Warn the trainer",
  suspend_trainer: "Suspend the trainer from consults",
  warn_person: "Warn the person",
  block_person: "Block the person from consults",
};
export const REFUND_LABEL: Record<RefundChoice, string> = { none: "No refund (pay the trainer)", partial: "Partial refund", full: "Full refund (the trainer isn't paid)" };

/* ---------------- Ratings ---------------- */
export function cleanStars(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** The average shown on a profile (one decimal), or null with no ratings. */
export function averageStars(list: number[]): number | null {
  if (!list.length) return null;
  return Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10;
}
