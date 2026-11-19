/*
 * Notification categories for the Notifications page. Every notification has a `kind` (set where it is created); this maps the
 * kind to one of the tabs. A kind nobody has mapped yet lands in "Other", so a new kind is never lost.
 */

export type NoteCategory = "booking" | "class" | "training" | "nutrition" | "clients" | "other";

export const CATEGORY_LABEL: Record<NoteCategory, string> = {
  booking: "Bookings",
  class: "Classes",
  training: "Training",
  nutrition: "Nutrition",
  clients: "Clients",
  other: "Other",
};

const BY_KIND: Record<string, NoteCategory> = {
  booking_changed: "booking",
  late_cancel: "booking",
  credits_low: "booking",
  package_expiring: "booking",
  no_show: "booking",
  session_transferred: "booking",
  join_request: "booking",
  request_approved: "booking",
  request_declined: "booking",
  request_expired: "booking",

  group_moved: "class",
  group_removed: "class",
  group_cancelled: "class",
  group_added: "class",
  group_workout: "class",
  waitlist_promoted: "class",
  waitlist_skipped: "class",

  client_workout: "training",
  workout_assigned: "training",
  client_import: "training",
  pain_report: "training",
  workout_comment: "training",
  workout_reaction: "training",

  nutrition_targets: "nutrition",
  nutrition_comment: "nutrition",

  coach_request: "clients",
  coach_accepted: "clients",
  coach_declined: "clients",
  intake_request: "clients",
  payment_received: "clients",
  referral_reward: "other",
  referral_joined: "other",
  payment_claimed: "clients",
  intake_submitted: "clients",
  intake_reviewed: "clients",
  intake_ack: "clients",
  intake_reminder: "clients",
  assessment_submitted: "clients",
  assessment_shared: "clients",
  assessment_ack: "clients",
};

export function categoryOf(kind: string): NoteCategory {
  return BY_KIND[kind] ?? "other";
}

/** Tabs shown on the page, in order ("all" is every notification). */
export const CATEGORY_ORDER: NoteCategory[] = ["booking", "class", "training", "nutrition", "clients", "other"];
