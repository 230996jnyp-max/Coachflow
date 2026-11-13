import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * users
 *  - OWNER (the app owner, also a coach) / COACH / CLIENT.
 *  - Staff rows keep `name` + `email` in plaintext (needed for the admin list and login by email).
 *  - Client personal data (name, phone, email, goal, medical notes, package credits…) lives ONLY inside `profile_enc`
 *    (AES-256-GCM). Passwords are bcrypt hashes. Clients are linked to their coach through `coach_id`.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    role: text("role").notNull(), // OWNER | COACH | CLIENT
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    email: text("email"),
    profileEnc: text("profile_enc").notNull(),
    coachId: text("coach_id"),
    unit: text("unit").notNull().default("metric"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    active: boolean("active").notNull().default(true),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    tokenVersion: integer("token_version").notNull().default(0),
    /** The guided tour has been finished or skipped (the Settings button can replay it). */
    onboarded: boolean("onboarded").notNull().default(false),
    /** Chosen colour theme (black | white | navy); null until the person picks one. */
    theme: text("theme"),
    /** A coach's 6-digit code, shared so clients can find them at sign-up (null for everyone else). Unique. */
    coachCode: text("coach_code"),
    /** False only for someone who signed themselves up and hasn't opened the link in their verification email yet. */
    emailVerified: boolean("email_verified").notNull().default(true),
    /** End of the 30-day free trial of a self sign-up (coach or personal). Null = no trial (coach-made clients, older accounts). */
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** Personal look and feel as JSON (accent, background, text size, bio ...). See lib/prefs.ts. Nothing sensitive. */
    prefs: text("prefs"),
    /** When they last signed in (shown to the owner on the Sign-ups tab). */
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Set when the owner disables the account: it can't sign in, and the data is kept. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_coach_idx").on(t.coachId), index("users_role_idx").on(t.role)],
);

/** Pictures a person uploaded (profile photo, background, coach banner and logo), already shrunk by the browser. One row per kind. */
export const userMedia = pgTable(
  "user_media",
  {
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(), // avatar | bg | banner | logo
    mime: text("mime").notNull(),
    dataB64: text("data_b64").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);


/*
 * Gyms and academies. A gym owner is a coach (a normal coach account) who also runs a gym: one row in gym_orgs, with roles the owner
 * defines (each a list of permissions), the members (coaches and staff, linked with the 6-digit gym code or an emailed invitation) and
 * the branches / halls. Coaches keep their own clients; the gym only sees schedules, hours and cover.
 */
export const gymOrgs = pgTable(
  "gym_orgs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    ownerId: text("owner_id").notNull(),
    /** Defaults handed to a coach when they link: theme (black | white | navy) and niches (JSON array). */
    theme: text("theme"),
    niches: text("niches").notNull().default("[]"),
    /** Do client no-shows count as worked time in the hours table? */
    countNoShows: boolean("count_no_shows").notNull().default(false),
    /** Bumped when the logo / banner is uploaded (the pictures live in user_media under the gym's id). */
    logoV: integer("logo_v").notNull().default(0),
    bannerV: integer("banner_v").notNull().default(0),
    /** The gym's free month. When it ends (and payments are enforced) the platform stops for the gym's coaches and admins. */
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** ACTIVE | DISABLED (switched off by the platform owner). */
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gym_orgs_code_idx").on(t.code)],
);

export const gymRoles = pgTable(
  "gym_roles",
  {
    id: text("id").primaryKey(),
    gymId: text("gym_id").notNull(),
    name: text("name").notNull(),
    /** JSON array of permission ids (see lib/gymPerms.ts). */
    perms: text("perms").notNull().default("[]"),
    /** The owner's role: all permissions, can't be edited or removed. */
    locked: boolean("locked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gym_roles_gym_idx").on(t.gymId)],
);

/** A person in a gym. One gym per person (user_id is unique). status: PENDING (asked with the code) | ACTIVE. */
export const gymMembers = pgTable(
  "gym_members",
  {
    gymId: text("gym_id").notNull(),
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
    status: text("status").notNull().default("PENDING"),
    branchId: text("branch_id"),
    /** Optional hourly rate in cents, to turn hours into an amount on the payroll table. */
    rateCents: integer("rate_cents"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.gymId, t.userId] }), uniqueIndex("gym_members_user_idx").on(t.userId)],
);

export const gymBranches = pgTable(
  "gym_branches",
  {
    id: text("id").primaryKey(),
    gymId: text("gym_id").notNull(),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gym_branches_gym_idx").on(t.gymId)],
);

/** An emailed invitation: the person joins without waiting for approval, with this role. */
export const gymInvites = pgTable(
  "gym_invites",
  {
    id: text("id").primaryKey(),
    gymId: text("gym_id").notNull(),
    email: text("email").notNull(),
    roleId: text("role_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gym_invites_email_idx").on(t.email)],
);

/** The gym asks to move a client to another coach of the gym for good. The client has to agree. */
export const gymMoves = pgTable(
  "gym_moves",
  {
    id: text("id").primaryKey(),
    gymId: text("gym_id").notNull(),
    clientId: text("client_id").notNull(),
    fromCoachId: text("from_coach_id").notNull(),
    toCoachId: text("to_coach_id").notNull(),
    status: text("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("gym_moves_client_idx").on(t.clientId, t.status)],
);

/** Who did what in a gym (linked, removed, cover, roles ...). */
export const gymAudit = pgTable(
  "gym_audit",
  {
    id: text("id").primaryKey(),
    gymId: text("gym_id").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    detail: text("detail").notNull().default(""),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gym_audit_gym_idx").on(t.gymId, t.at)],
);

/** One row per AI call (feature: workout_import | niche_search | custom_tracking | progression | other), for the owner's usage tracker. */
export const aiUsageLog = pgTable(
  "ai_usage_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** The coach the call belongs to (the person themselves for a coach, their coach for a client) and that coach's gym, when they have one. */
    coachId: text("coach_id"),
    gymId: text("gym_id"),
    feature: text("feature").notNull(),
    units: integer("units").notNull().default(1),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_log_at_idx").on(t.at), index("ai_usage_log_user_idx").on(t.userId)],
);


/*
 * "Before we meet": the pack of forms a coach asks a client to fill in, every submitted version of each form, posture and fitness
 * assessments, and the posture photos. Everything a person wrote is encrypted in data_enc; only what is needed to list and sort is plain.
 */
export const intakeRequests = pgTable(
  "intake_requests",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    coachId: text("coach_id").notNull(),
    /** JSON array of form kinds asked for (PARQ, DECLARATION, GOALS). */
    kinds: text("kinds").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set once the reminder before the first session has gone out. */
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  },
  (t) => [index("intake_requests_client_idx").on(t.clientId, t.createdAt)],
);

/** One row per submitted version of a form. The newest of each kind is the current one; older ones are the history. */
export const intakeForms = pgTable(
  "intake_forms",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    coachId: text("coach_id").notNull(),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    dataEnc: text("data_enc").notNull(),
    /** Number of "yes" answers on a health questionnaire (0 for the other forms). */
    flags: integer("flags").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    /** The coach has looked at it (with an optional note, kept encrypted) and gave the client a copy. */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewEnc: text("review_enc"),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    /** The client read the copy and acknowledged it. */
    ackAt: timestamp("ack_at", { withTimezone: true }),
  },
  (t) => [index("intake_forms_client_idx").on(t.clientId, t.kind, t.version)],
);

/** A posture and fitness assessment. filled_by COACH or CLIENT; status DRAFT or DONE. */
export const assessments = pgTable(
  "assessments",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    coachId: text("coach_id").notNull(),
    filledBy: text("filled_by").notNull(),
    status: text("status").notNull().default("DRAFT"),
    takenAt: text("taken_at").notNull(),
    dataEnc: text("data_enc").notNull(),
    /** A coach's assessment given to the client as a copy, and the client's acknowledgement. */
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    ackAt: timestamp("ack_at", { withTimezone: true }),
    /** The coach has opened a client's own assessment. */
    seenAt: timestamp("seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assessments_client_idx").on(t.clientId, t.takenAt)],
);

/** A posture photo (front, side or back) of one assessment, encrypted. */
export const assessmentPhotos = pgTable(
  "assessment_photos",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id").notNull(),
    clientId: text("client_id").notNull(),
    view: text("view").notNull(),
    dataEnc: text("data_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assessment_photos_view_idx").on(t.assessmentId, t.view)],
);

/** What the owner did to an account (disable, enable, delete ...). Kept after the account itself is gone; holds no private data. */
export const adminActions = pgTable(
  "admin_actions",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    targetId: text("target_id").notNull(),
    targetLabel: text("target_label").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_actions_at_idx").on(t.at)],
);

/**
 * One-time links sent by email: `verify` (confirm an address after sign-up) and `reset` (choose a new password). Only a hash of the
 * token is stored, so a copy of the table can't be used to take over an account.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_tokens_hash_idx").on(t.tokenHash), index("auth_tokens_user_idx").on(t.userId, t.kind)],
);

/** A person who signed up (or later asked) to train with a coach, waiting for that coach to accept. */
export const coachLinks = pgTable(
  "coach_links",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    coachId: text("coach_id").notNull(),
    /** PENDING | ACCEPTED | DECLINED | CANCELLED */
    status: text("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("coach_links_coach_idx").on(t.coachId, t.status), index("coach_links_client_idx").on(t.clientId, t.status)],
);

/** One row per rate-limited event (sign-up, code lookup, password reset ...), keyed by what is being limited. Old rows are pruned as they are read. */
export const rateEvents = pgTable(
  "rate_events",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rate_events_key_idx").on(t.key, t.at)],
);

/**
 * A workout a coach assigned to a client for one day. The plan (title, note, a copy of the routine's exercises) is encrypted; the day is
 * kept in the clear to sort by and to find a client's week. `series_id` ties together the copies made by "repeat weekly".
 */
export const assignments = pgTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    coachId: text("coach_id").notNull(),
    date: text("date").notNull(),
    seriesId: text("series_id"),
    dataEnc: text("data_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assignments_client_idx").on(t.clientId, t.date), index("assignments_coach_idx").on(t.coachId, t.date)],
);

/** A coach's saved reply (a short title and the message, encrypted), inserted into a chat with one tap. Private to that coach. */
export const savedReplies = pgTable(
  "saved_replies",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    dataEnc: text("data_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_replies_owner_idx").on(t.ownerId, t.createdAt)],
);

/** A body check-in (weight, body fat, measurements). The numbers are encrypted; `date` (yyyy-MM-dd) is kept in the clear to sort by. */
export const bodyLogs = pgTable(
  "body_logs",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    date: text("date").notNull(),
    dataEnc: text("data_enc").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("body_logs_client_idx").on(t.clientId, t.date), index("body_logs_updated_idx").on(t.updatedAt)],
);

/**
 * A progress photo. The details (pose, weight, notes) and the picture itself are separate encrypted columns, so lists never read
 * the picture: it is only decrypted when the image address is opened by the client or their coach.
 */
export const progressPhotos = pgTable(
  "progress_photos",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    date: text("date").notNull(),
    metaEnc: text("meta_enc").notNull(),
    imageEnc: text("image_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("progress_photos_client_idx").on(t.clientId, t.date), index("progress_photos_created_idx").on(t.createdAt)],
);

/** A coach's private note about a client (the text is encrypted). Clients never receive these. */
export const clientNotes = pgTable(
  "client_notes",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    coachId: text("coach_id").notNull(),
    bodyEnc: text("body_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("client_notes_client_idx").on(t.clientId, t.createdAt)],
);

/** A comment under a workout, between the client and their coach (the text is encrypted). `clientId` is the workout's owner. */
export const workoutComments = pgTable(
  "workout_comments",
  {
    id: text("id").primaryKey(),
    workoutId: text("workout_id").notNull(),
    clientId: text("client_id").notNull(),
    authorId: text("author_id").notNull(),
    bodyEnc: text("body_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workout_comments_workout_idx").on(t.workoutId, t.createdAt), index("workout_comments_client_idx").on(t.clientId)],
);

/** A quick 👍 / 🔥 on a workout. One row per person per emoji. */
export const workoutReactions = pgTable(
  "workout_reactions",
  {
    workoutId: text("workout_id").notNull(),
    userId: text("user_id").notNull(),
    emoji: text("emoji").notNull(),
    clientId: text("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workoutId, t.userId, t.emoji] }), index("workout_reactions_client_idx").on(t.clientId)],
);

/** People who asked to hear when the AI personal trainer is ready. Only an address and which side of the app they came from. */
export const aiWaitlist = pgTable("ai_waitlist", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  interest: text("interest").notNull().default("train"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * messages — body and email-delivery metadata are encrypted. `thread` is `c:<clientId>` (coach ↔ client) or
 * `o:<coachId>` (owner ↔ coach).
 */
export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    thread: text("thread").notNull(),
    fromId: text("from_id").notNull(),
    bodyEnc: text("body_enc").notNull(),
    metaEnc: text("meta_enc"),
    broadcast: boolean("broadcast").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_thread_idx").on(t.thread, t.createdAt)],
);

/** Per-coach booking rules. `utc_offset_min` is the coach's local UTC offset (Singapore = 480) used to place availability windows. */
export const coachSettings = pgTable("coach_settings", {
  coachId: text("coach_id").primaryKey(),
  sessionMinutes: integer("session_minutes").notNull().default(60),
  noticeHours: integer("notice_hours").notNull().default(12),
  autoConfirm: boolean("auto_confirm").notNull().default(true),
  allowCustomGym: boolean("allow_custom_gym").notNull().default(true),
  utcOffsetMin: integer("utc_offset_min").notNull().default(480),
  /** Travel buffer between sessions at different locations (see lib/travel.ts). */
  travelEnabled: boolean("travel_enabled").notNull().default(true),
  travelDefaultMin: integer("travel_default_min").notNull().default(30),
  travelParkingMin: integer("travel_parking_min").notNull().default(15),
  travelMaxMin: integer("travel_max_min").notNull().default(90),
  /** The coach's starter routines were created once (so a second device or a deleted routine never re-adds them). */
  templatesSeeded: boolean("templates_seeded").notNull().default(false),
  /** Coaching specialties and the sports the coach added with AI (JSON arrays of names). */
  specialties: text("specialties").notNull().default("[]"),
  sports: text("sports").notNull().default("[]"),
  /** Niches whose starter routines were already copied to this coach (so a deleted routine never comes back), and the shared-library drills the coach hid (JSON arrays). */
  nicheTemplates: text("niche_templates").notNull().default("[]"),
  hiddenExercises: text("hidden_exercises").notNull().default("[]"),
});

/**
 * The shared exercise library: drills generated for a niche (Yoga, Powerlifting, Muay Thai ...) that every coach working in that
 * niche can use. Nothing personal is stored, so it is plain JSON. Deduplicated by niche + normalised name.
 */
export const globalExercises = pgTable(
  "global_exercises",
  {
    id: text("id").primaryKey(),
    niche: text("niche").notNull(),
    nameKey: text("name_key").notNull(),
    data: text("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("global_exercises_niche_idx").on(t.niche)],
);

/**
 * Coach sign-up requests from the public form. The owner approves (a coach account is created and the login is emailed) or declines.
 * The phone number is personal data, so it is stored encrypted; `ip_hash` only exists to limit how often one network can ask.
 */
export const coachSignupRequests = pgTable(
  "coach_signup_requests",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phoneEnc: text("phone_enc").notNull(),
    /** PENDING | APPROVED | REJECTED */
    status: text("status").notNull().default("PENDING"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    /** The coach account created on approval. */
    coachId: text("coach_id"),
  },
  (t) => [index("coach_signup_status_idx").on(t.status, t.createdAt)],
);
export type CoachSignupRow = typeof coachSignupRequests.$inferSelect;

/** How many AI calls a person made today, by kind (limits protect the shared free AI quota). */
export const aiUsage = pgTable(
  "ai_usage",
  {
    userId: text("user_id").notNull(),
    day: text("day").notNull(),
    kind: text("kind").notNull(),
    n: integer("n").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.kind] })],
);

/** Short AI-written sentences (why a target was suggested, a client brief), kept so each is only written once. */
export const aiNotes = pgTable("ai_notes", {
  key: text("key").primaryKey(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Food diary. Each entry is one encrypted blob (what was eaten, the numbers); the plain columns are only for access checks and listing by day. */
export const nutritionEntries = pgTable(
  "nutrition_entries",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    day: text("day").notNull(),
    dataEnc: text("data_enc").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("nutrition_entries_client_idx").on(t.clientId, t.day)],
);

/** A person's calorie and macro targets (set by their coach, or by themselves). */
export const nutritionTargets = pgTable("nutrition_targets", {
  clientId: text("client_id").primaryKey(),
  dataEnc: text("data_enc").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Diets, allergies and the "I'm 18 or older" answer. */
export const nutritionSettings = pgTable("nutrition_settings", {
  clientId: text("client_id").primaryKey(),
  dataEnc: text("data_enc").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A coach's comment on one day of a client's food diary. */
export const nutritionComments = pgTable(
  "nutrition_comments",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    day: text("day").notNull(),
    dataEnc: text("data_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("nutrition_comments_client_idx").on(t.clientId, t.day)],
);

/** Starter routines for a niche, shared by all coaches (exercise ids point at library exercises). */
export const globalTemplates = pgTable(
  "global_templates",
  {
    id: text("id").primaryKey(),
    niche: text("niche").notNull(),
    data: text("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("global_templates_niche_idx").on(t.niche)],
);

/** Progress of the background library builder for a niche (a short lock stops two coaches building the same niche at once). */
export const nicheSeed = pgTable("niche_seed", {
  niche: text("niche").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  /** Batches in a row that added (almost) nothing new; the builder stops at 2. */
  stale: integer("stale").notNull().default(0),
  batches: integer("batches").notNull().default(0),
  done: boolean("done").notNull().default(false),
});

export const gyms = pgTable(
  "gyms",
  {
    id: text("id").primaryKey(),
    coachId: text("coach_id").notNull(),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("gyms_coach_idx").on(t.coachId)],
);

/** Availability windows: RECURRING (weekday), ONE_OFF (date) or BLOCK (date). Times are "HH:mm" in the coach's local time. */
export const slots = pgTable(
  "slots",
  {
    id: text("id").primaryKey(),
    coachId: text("coach_id").notNull(),
    kind: text("kind").notNull(),
    weekday: integer("weekday"),
    date: text("date"),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    label: text("label"),
  },
  (t) => [index("slots_coach_idx").on(t.coachId)],
);

/**
 * Sessions. Times, status and focus are plain (needed for scheduling); notes, the free-text location and the saved-gym
 * reference are encrypted in `details_enc` (AES-256-GCM, bound to the booking id).
 */
export const bookings = pgTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    coachId: text("coach_id").notNull(),
    clientId: text("client_id").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    focus: text("focus").notNull().default("Full Body"),
    createdBy: text("created_by").notNull(),
    rev: integer("rev").notNull().default(0),
    detailsEnc: text("details_enc").notNull(),
    /** Set when a gym arranged cover: the coach this session belonged to before (coach_id is now the cover coach). */
    originalCoachId: text("original_coach_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bookings_coach_idx").on(t.coachId, t.startAt), index("bookings_client_idx").on(t.clientId)],
);

/** Secret calendar-subscription token per coach: only a hash is used for lookup; the token itself is stored encrypted so the coach can copy the link again. */
export const calendarTokens = pgTable("calendar_tokens", {
  userId: text("user_id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenEnc: text("token_enc").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Logged / in-progress workouts. The whole workout (exercises, sets, notes, location) is encrypted in `data_enc`; only what is needed to list and sync is plain. */
export const workouts = pgTable(
  "workouts",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    dataEnc: text("data_enc").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workouts_client_idx").on(t.clientId, t.startedAt), index("workouts_updated_idx").on(t.updatedAt)],
);

/** Routine templates. A coach's `shared` templates are visible to that coach's clients. */
export const templates = pgTable(
  "templates",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    shared: boolean("shared").notNull().default(false),
    dataEnc: text("data_enc").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("templates_owner_idx").on(t.ownerId)],
);

/** Custom exercises created by a coach or client (the built-in library ships with the app). */
export const customExercises = pgTable(
  "custom_exercises",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    dataEnc: text("data_enc").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("custom_exercises_owner_idx").on(t.ownerId)],
);

/** A coach's own tracking format for one exercise (set-table columns + the chart metric), applied to the coach and their clients. */
export const exerciseTracking = pgTable(
  "exercise_tracking",
  {
    coachId: text("coach_id").notNull(),
    exerciseId: text("exercise_id").notNull(),
    dataEnc: text("data_enc").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.coachId, t.exerciseId] })],
);

/**
 * Group classes (coach-scheduled, kind CLASS) and client sessions opened to partners (kind SHARED, linked to a booking).
 * Title, notes, location, template and the pushed workout plan are encrypted in `details_enc` (bound to the group id).
 */
export const groupSessions = pgTable(
  "group_sessions",
  {
    id: text("id").primaryKey(),
    coachId: text("coach_id").notNull(),
    kind: text("kind").notNull(),
    bookingId: text("booking_id"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    status: text("status").notNull().default("OPEN"),
    seriesId: text("series_id"),
    workoutStartedAt: timestamp("workout_started_at", { withTimezone: true }),
    rev: integer("rev").notNull().default(0),
    detailsEnc: text("details_enc").notNull(),
    originalCoachId: text("original_coach_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("group_sessions_coach_idx").on(t.coachId, t.startAt), index("group_sessions_booking_idx").on(t.bookingId)],
);

/** Who is in a group. status: CONFIRMED | WAITLIST | CANCELLED | ATTENDED | ABSENT. */
export const groupMembers = pgTable(
  "group_members",
  {
    groupId: text("group_id").notNull(),
    clientId: text("client_id").notNull(),
    status: text("status").notNull(),
    role: text("role").notNull().default("MEMBER"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.clientId] }), index("group_members_client_idx").on(t.clientId)],
);

/** A client asking to join a shared session; the coach and every current attendee must approve. */
export const groupRequests = pgTable(
  "group_requests",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").notNull(),
    clientId: text("client_id").notNull(),
    status: text("status").notNull().default("PENDING"),
    /** JSON { [userId]: "APPROVED" | "DECLINED" } */
    approvals: text("approvals").notNull().default("{}"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("group_requests_group_idx").on(t.groupId), index("group_requests_client_idx").on(t.clientId)],
);

/** In-app notifications (the text is encrypted: it can name people and times). */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    bodyEnc: text("body_enc").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

/**
 * One row per person per session once the coach has marked them Present or No-Show. `charged` says whether a credit is
 * currently taken for it, so changing a mark later only ever moves the balance by the difference (never double counts).
 */
export const attendance = pgTable(
  "attendance",
  {
    /** `<kind>:<sessionId>:<clientId>` */
    id: text("id").primaryKey(),
    kind: text("kind").notNull(), // BOOKING | GROUP
    sessionId: text("session_id").notNull(),
    clientId: text("client_id").notNull(),
    coachId: text("coach_id").notNull(),
    pool: text("pool").notNull(), // SESSION | GROUP
    mark: text("mark").notNull(), // PRESENT | NO_SHOW
    charged: boolean("charged").notNull().default(false),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attendance_client_idx").on(t.clientId), index("attendance_session_idx").on(t.kind, t.sessionId)],
);

/** Credit transaction history. The figures and labels are encrypted (credits are private to the client and coach). */
export const creditLog = pgTable(
  "credit_log",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    coachId: text("coach_id").notNull(),
    pool: text("pool").notNull(),
    kind: text("kind").notNull(),
    dataEnc: text("data_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_log_client_idx").on(t.clientId, t.createdAt)],
);

/*
 * Payments between a coach and their clients. The money never touches this app: a client pays into the coach's own Stripe account
 * (Connect, Standard) or straight to the coach by PayNow / cash, and this only keeps the records and adds the credits.
 */

/** One row per coach who set up payments: their Stripe account (if any) and the PayNow number they show clients. */
export const paymentSettings = pgTable("payment_settings", {
  coachId: text("coach_id").primaryKey(),
  stripeAccountId: text("stripe_account_id"),
  chargesEnabled: boolean("charges_enabled").notNull().default(false),
  detailsSubmitted: boolean("details_submitted").notNull().default(false),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  /** The coach's PayNow mobile number or UEN, shown to a client who chooses the no-fee option. */
  paynow: text("paynow"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** What a coach sells: a number of session credits (and optional group credits) for a price. */
export const paymentPackages = pgTable(
  "payment_packages",
  {
    id: text("id").primaryKey(),
    coachId: text("coach_id").notNull(),
    name: text("name").notNull(),
    sessions: integer("sessions").notNull(),
    groupCredits: integer("group_credits").notNull().default(0),
    priceCents: integer("price_cents").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payment_packages_coach_idx").on(t.coachId)],
);

/**
 * One row per payment (asked for, paid, refunded). The package, price and credits are copied at the time, so changing a package later never
 * changes what was sold. `applied_*` is what was really added to the client, so a refund takes back exactly that (never more than is left).
 */
export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: text("id").primaryKey(),
    /** An unguessable code for the pay link, so a parent or guardian can pay without an account. */
    token: text("token").notNull(),
    /** Short reference the payer types into a PayNow transfer. */
    ref: text("ref").notNull(),
    coachId: text("coach_id").notNull(),
    clientId: text("client_id").notNull(),
    packageId: text("package_id"),
    name: text("name").notNull(),
    sessions: integer("sessions").notNull().default(0),
    groupCredits: integer("group_credits").notNull().default(0),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("sgd"),
    /** STRIPE (card, Apple Pay, Google Pay, PayNow through Stripe), PAYNOW (direct to the coach, they confirm) or MANUAL (cash, bank transfer: the coach records it). */
    method: text("method").notNull().default("STRIPE"),
    manualKind: text("manual_kind"),
    /** PENDING, AWAITING (the payer says they paid by PayNow; the coach confirms), PAID, REFUNDED, CANCELLED. */
    status: text("status").notNull().default("PENDING"),
    stripeSessionId: text("stripe_session_id"),
    paymentIntentId: text("payment_intent_id"),
    receiptUrl: text("receipt_url"),
    appliedSessions: integer("applied_sessions").notNull().default(0),
    appliedGroup: integer("applied_group").notNull().default(0),
    noteEnc: text("note_enc"),
    createdBy: text("created_by").notNull().default("COACH"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_orders_token_idx").on(t.token), index("payment_orders_coach_idx").on(t.coachId, t.createdAt), index("payment_orders_client_idx").on(t.clientId, t.createdAt)],
);

/** Stripe event ids already handled, so a webhook that is sent twice only adds credits once. */
export const paymentEvents = pgTable("payment_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type PaymentOrderRow = typeof paymentOrders.$inferSelect;
export type PaymentPackageRow = typeof paymentPackages.$inferSelect;
export type PaymentSettingsRow = typeof paymentSettings.$inferSelect;
export type AttendanceRow = typeof attendance.$inferSelect;
export type GroupRow = typeof groupSessions.$inferSelect;
export type GroupMemberRow = typeof groupMembers.$inferSelect;
export type GroupRequestRow = typeof groupRequests.$inferSelect;
export type WorkoutRow = typeof workouts.$inferSelect;
export type NutritionEntryRow = typeof nutritionEntries.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
export type CustomExerciseRow = typeof customExercises.$inferSelect;
export type ExerciseTrackingRow = typeof exerciseTracking.$inferSelect;
export type BookingRow = typeof bookings.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

/** Idempotent DDL applied once per server instance (see db.ts). Mirrors the tables above. */
export const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    role text NOT NULL,
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    name text,
    email text,
    profile_enc text NOT NULL,
    coach_id text,
    unit text NOT NULL DEFAULT 'metric',
    must_change_password boolean NOT NULL DEFAULT true,
    active boolean NOT NULL DEFAULT true,
    failed_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    token_version integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS users_coach_idx ON users (coach_id)`,
  `CREATE INDEX IF NOT EXISTS users_role_idx ON users (role)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS theme text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS coach_code text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_coach_code_idx ON users (coach_code) WHERE coach_code IS NOT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS users_email_idx ON users (lower(email))`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS prefs text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz`,
  `CREATE TABLE IF NOT EXISTS user_media (
    user_id text NOT NULL,
    kind text NOT NULL,
    mime text NOT NULL,
    data_b64 text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_actions (
    id text PRIMARY KEY,
    actor_id text NOT NULL,
    target_id text NOT NULL,
    target_label text NOT NULL,
    action text NOT NULL,
    reason text,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS admin_actions_at_idx ON admin_actions (at)`,
  `CREATE TABLE IF NOT EXISTS gym_orgs (
    id text PRIMARY KEY,
    name text NOT NULL,
    code text NOT NULL,
    owner_id text NOT NULL,
    theme text,
    niches text NOT NULL DEFAULT '[]',
    count_no_shows boolean NOT NULL DEFAULT false,
    logo_v integer NOT NULL DEFAULT 0,
    banner_v integer NOT NULL DEFAULT 0,
    trial_ends_at timestamptz,
    status text NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS gym_orgs_code_idx ON gym_orgs (code)`,
  `CREATE TABLE IF NOT EXISTS gym_roles (
    id text PRIMARY KEY,
    gym_id text NOT NULL,
    name text NOT NULL,
    perms text NOT NULL DEFAULT '[]',
    locked boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS gym_roles_gym_idx ON gym_roles (gym_id)`,
  `CREATE TABLE IF NOT EXISTS gym_members (
    gym_id text NOT NULL,
    user_id text NOT NULL,
    role_id text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    branch_id text,
    rate_cents integer,
    requested_at timestamptz NOT NULL DEFAULT now(),
    joined_at timestamptz,
    PRIMARY KEY (gym_id, user_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS gym_members_user_idx ON gym_members (user_id)`,
  `CREATE TABLE IF NOT EXISTS gym_branches (
    id text PRIMARY KEY,
    gym_id text NOT NULL,
    name text NOT NULL,
    address text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS gym_branches_gym_idx ON gym_branches (gym_id)`,
  `CREATE TABLE IF NOT EXISTS gym_invites (
    id text PRIMARY KEY,
    gym_id text NOT NULL,
    email text NOT NULL,
    role_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS gym_invites_email_idx ON gym_invites (email)`,
  `CREATE TABLE IF NOT EXISTS gym_moves (
    id text PRIMARY KEY,
    gym_id text NOT NULL,
    client_id text NOT NULL,
    from_coach_id text NOT NULL,
    to_coach_id text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS gym_moves_client_idx ON gym_moves (client_id, status)`,
  `CREATE TABLE IF NOT EXISTS gym_audit (
    id text PRIMARY KEY,
    gym_id text NOT NULL,
    actor_id text NOT NULL,
    action text NOT NULL,
    detail text NOT NULL DEFAULT '',
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS gym_audit_gym_idx ON gym_audit (gym_id, at)`,
  `CREATE TABLE IF NOT EXISTS ai_usage_log (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    coach_id text,
    gym_id text,
    feature text NOT NULL,
    units integer NOT NULL DEFAULT 1,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS ai_usage_log_at_idx ON ai_usage_log (at)`,
  `CREATE INDEX IF NOT EXISTS ai_usage_log_user_idx ON ai_usage_log (user_id)`,
  `CREATE TABLE IF NOT EXISTS auth_tokens (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS auth_tokens_hash_idx ON auth_tokens (token_hash)`,
  `CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens (user_id, kind)`,
  `CREATE TABLE IF NOT EXISTS coach_links (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    coach_id text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS coach_links_coach_idx ON coach_links (coach_id, status)`,
  `CREATE INDEX IF NOT EXISTS coach_links_client_idx ON coach_links (client_id, status)`,
  `CREATE TABLE IF NOT EXISTS rate_events (
    id text PRIMARY KEY,
    key text NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS rate_events_key_idx ON rate_events (key, at)`,
  `CREATE TABLE IF NOT EXISTS assignments (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    coach_id text NOT NULL,
    date text NOT NULL,
    series_id text,
    data_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS assignments_client_idx ON assignments (client_id, date)`,
  `CREATE INDEX IF NOT EXISTS assignments_coach_idx ON assignments (coach_id, date)`,
  `CREATE TABLE IF NOT EXISTS saved_replies (
    id text PRIMARY KEY,
    owner_id text NOT NULL,
    data_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS saved_replies_owner_idx ON saved_replies (owner_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS body_logs (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    date text NOT NULL,
    data_enc text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS body_logs_client_idx ON body_logs (client_id, date)`,
  `CREATE INDEX IF NOT EXISTS body_logs_updated_idx ON body_logs (updated_at)`,
  `CREATE TABLE IF NOT EXISTS progress_photos (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    date text NOT NULL,
    meta_enc text NOT NULL,
    image_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS progress_photos_client_idx ON progress_photos (client_id, date)`,
  `CREATE INDEX IF NOT EXISTS progress_photos_created_idx ON progress_photos (created_at)`,
  `CREATE TABLE IF NOT EXISTS client_notes (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    coach_id text NOT NULL,
    body_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS client_notes_client_idx ON client_notes (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS workout_comments (
    id text PRIMARY KEY,
    workout_id text NOT NULL,
    client_id text NOT NULL,
    author_id text NOT NULL,
    body_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS workout_comments_workout_idx ON workout_comments (workout_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS workout_comments_client_idx ON workout_comments (client_id)`,
  `CREATE TABLE IF NOT EXISTS workout_reactions (
    workout_id text NOT NULL,
    user_id text NOT NULL,
    emoji text NOT NULL,
    client_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workout_id, user_id, emoji)
  )`,
  `CREATE INDEX IF NOT EXISTS workout_reactions_client_idx ON workout_reactions (client_id)`,
  `CREATE TABLE IF NOT EXISTS ai_waitlist (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    interest text NOT NULL DEFAULT 'train',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id text PRIMARY KEY,
    thread text NOT NULL,
    from_id text NOT NULL,
    body_enc text NOT NULL,
    meta_enc text,
    broadcast boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread, created_at)`,
  `CREATE TABLE IF NOT EXISTS coach_settings (
    coach_id text PRIMARY KEY,
    session_minutes integer NOT NULL DEFAULT 60,
    notice_hours integer NOT NULL DEFAULT 12,
    auto_confirm boolean NOT NULL DEFAULT true,
    allow_custom_gym boolean NOT NULL DEFAULT true,
    utc_offset_min integer NOT NULL DEFAULT 480
  )`,
  `CREATE TABLE IF NOT EXISTS gyms (
    id text PRIMARY KEY,
    coach_id text NOT NULL,
    name text NOT NULL,
    address text NOT NULL DEFAULT '',
    active boolean NOT NULL DEFAULT true
  )`,
  `CREATE INDEX IF NOT EXISTS gyms_coach_idx ON gyms (coach_id)`,
  `CREATE TABLE IF NOT EXISTS slots (
    id text PRIMARY KEY,
    coach_id text NOT NULL,
    kind text NOT NULL,
    weekday integer,
    date text,
    start_time text NOT NULL,
    end_time text NOT NULL,
    label text
  )`,
  `CREATE INDEX IF NOT EXISTS slots_coach_idx ON slots (coach_id)`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id text PRIMARY KEY,
    coach_id text NOT NULL,
    client_id text NOT NULL,
    start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,
    status text NOT NULL,
    focus text NOT NULL DEFAULT 'Full Body',
    created_by text NOT NULL,
    rev integer NOT NULL DEFAULT 0,
    details_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS bookings_coach_idx ON bookings (coach_id, start_at)`,
  `CREATE INDEX IF NOT EXISTS bookings_client_idx ON bookings (client_id)`,
  `CREATE TABLE IF NOT EXISTS calendar_tokens (
    user_id text PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    token_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE coach_settings ADD COLUMN IF NOT EXISTS templates_seeded boolean NOT NULL DEFAULT false`,
  `ALTER TABLE coach_settings ADD COLUMN IF NOT EXISTS travel_enabled boolean NOT NULL DEFAULT true`,
  `ALTER TABLE coach_settings ADD COLUMN IF NOT EXISTS travel_default_min integer NOT NULL DEFAULT 30`,
  `ALTER TABLE coach_settings ADD COLUMN IF NOT EXISTS travel_parking_min integer NOT NULL DEFAULT 15`,
  `ALTER TABLE coach_settings ADD COLUMN IF NOT EXISTS travel_max_min integer NOT NULL DEFAULT 90`,
  `CREATE TABLE IF NOT EXISTS workouts (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    started_at timestamptz NOT NULL,
    status text NOT NULL,
    data_enc text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS workouts_client_idx ON workouts (client_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS workouts_updated_idx ON workouts (updated_at)`,
  `CREATE TABLE IF NOT EXISTS templates (
    id text PRIMARY KEY,
    owner_id text NOT NULL,
    shared boolean NOT NULL DEFAULT false,
    data_enc text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS templates_owner_idx ON templates (owner_id)`,
  `CREATE TABLE IF NOT EXISTS custom_exercises (
    id text PRIMARY KEY,
    owner_id text NOT NULL,
    data_enc text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS custom_exercises_owner_idx ON custom_exercises (owner_id)`,
  `ALTER TABLE coach_settings ADD COLUMN IF NOT EXISTS specialties text NOT NULL DEFAULT '[]'`,
  `ALTER TABLE coach_settings ADD COLUMN IF NOT EXISTS sports text NOT NULL DEFAULT '[]'`,
  `ALTER TABLE coach_settings ADD COLUMN IF NOT EXISTS niche_templates text NOT NULL DEFAULT '[]'`,
  `ALTER TABLE coach_settings ADD COLUMN IF NOT EXISTS hidden_exercises text NOT NULL DEFAULT '[]'`,
  `CREATE TABLE IF NOT EXISTS global_exercises (
    id text PRIMARY KEY,
    niche text NOT NULL,
    name_key text NOT NULL,
    data text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (niche, name_key)
  )`,
  `CREATE INDEX IF NOT EXISTS global_exercises_niche_idx ON global_exercises (niche)`,
  `CREATE TABLE IF NOT EXISTS coach_signup_requests (
    id text PRIMARY KEY,
    full_name text NOT NULL,
    email text NOT NULL,
    phone_enc text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    ip_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    reviewed_by text,
    coach_id text
  )`,
  `CREATE INDEX IF NOT EXISTS coach_signup_status_idx ON coach_signup_requests (status, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS coach_signup_pending_email ON coach_signup_requests (email) WHERE status = 'PENDING'`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
    user_id text NOT NULL,
    day text NOT NULL,
    kind text NOT NULL,
    n integer NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_notes (
    key text PRIMARY KEY,
    text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS nutrition_entries (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    day text NOT NULL,
    data_enc text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS nutrition_entries_client_idx ON nutrition_entries (client_id, day)`,
  `CREATE TABLE IF NOT EXISTS nutrition_targets (
    client_id text PRIMARY KEY,
    data_enc text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS nutrition_settings (
    client_id text PRIMARY KEY,
    data_enc text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS nutrition_comments (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    day text NOT NULL,
    data_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS nutrition_comments_client_idx ON nutrition_comments (client_id, day)`,
  `CREATE TABLE IF NOT EXISTS global_templates (
    id text PRIMARY KEY,
    niche text NOT NULL,
    data text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS global_templates_niche_idx ON global_templates (niche)`,
  `CREATE TABLE IF NOT EXISTS niche_seed (
    niche text PRIMARY KEY,
    locked_until timestamptz,
    stale integer NOT NULL DEFAULT 0,
    batches integer NOT NULL DEFAULT 0,
    done boolean NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS exercise_tracking (
    coach_id text NOT NULL,
    exercise_id text NOT NULL,
    data_enc text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (coach_id, exercise_id)
  )`,
  `CREATE TABLE IF NOT EXISTS group_sessions (
    id text PRIMARY KEY,
    coach_id text NOT NULL,
    kind text NOT NULL,
    booking_id text,
    start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,
    capacity integer NOT NULL,
    status text NOT NULL DEFAULT 'OPEN',
    series_id text,
    workout_started_at timestamptz,
    rev integer NOT NULL DEFAULT 0,
    details_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS group_sessions_coach_idx ON group_sessions (coach_id, start_at)`,
  `CREATE INDEX IF NOT EXISTS group_sessions_booking_idx ON group_sessions (booking_id)`,
  `CREATE TABLE IF NOT EXISTS group_members (
    group_id text NOT NULL,
    client_id text NOT NULL,
    status text NOT NULL,
    role text NOT NULL DEFAULT 'MEMBER',
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, client_id)
  )`,
  `CREATE INDEX IF NOT EXISTS group_members_client_idx ON group_members (client_id)`,
  `CREATE TABLE IF NOT EXISTS group_requests (
    id text PRIMARY KEY,
    group_id text NOT NULL,
    client_id text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    approvals text NOT NULL DEFAULT '{}',
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS group_requests_group_idx ON group_requests (group_id)`,
  `CREATE INDEX IF NOT EXISTS group_requests_client_idx ON group_requests (client_id)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL,
    body_enc text NOT NULL,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS attendance (
    id text PRIMARY KEY,
    kind text NOT NULL,
    session_id text NOT NULL,
    client_id text NOT NULL,
    coach_id text NOT NULL,
    pool text NOT NULL,
    mark text NOT NULL,
    charged boolean NOT NULL DEFAULT false,
    marked_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS attendance_client_idx ON attendance (client_id)`,
  `CREATE INDEX IF NOT EXISTS attendance_session_idx ON attendance (kind, session_id)`,
  `CREATE TABLE IF NOT EXISTS credit_log (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    coach_id text NOT NULL,
    pool text NOT NULL,
    kind text NOT NULL,
    data_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS credit_log_client_idx ON credit_log (client_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS intake_requests (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    coach_id text NOT NULL,
    kinds text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    reminder_sent_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS intake_requests_client_idx ON intake_requests (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS intake_forms (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    coach_id text NOT NULL,
    kind text NOT NULL,
    version integer NOT NULL,
    data_enc text NOT NULL,
    flags integer NOT NULL DEFAULT 0,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    review_enc text,
    shared_at timestamptz,
    ack_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS intake_forms_client_idx ON intake_forms (client_id, kind, version)`,
  `CREATE TABLE IF NOT EXISTS assessments (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    coach_id text NOT NULL,
    filled_by text NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',
    taken_at text NOT NULL,
    data_enc text NOT NULL,
    shared_at timestamptz,
    ack_at timestamptz,
    seen_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS assessments_client_idx ON assessments (client_id, taken_at)`,
  `CREATE TABLE IF NOT EXISTS assessment_photos (
    id text PRIMARY KEY,
    assessment_id text NOT NULL,
    client_id text NOT NULL,
    view text NOT NULL,
    data_enc text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS assessment_photos_view_idx ON assessment_photos (assessment_id, view)`,
  `CREATE TABLE IF NOT EXISTS payment_settings (
    coach_id text PRIMARY KEY,
    stripe_account_id text,
    charges_enabled boolean NOT NULL DEFAULT false,
    details_submitted boolean NOT NULL DEFAULT false,
    payouts_enabled boolean NOT NULL DEFAULT false,
    paynow text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS payment_packages (
    id text PRIMARY KEY,
    coach_id text NOT NULL,
    name text NOT NULL,
    sessions integer NOT NULL,
    group_credits integer NOT NULL DEFAULT 0,
    price_cents integer NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS payment_packages_coach_idx ON payment_packages (coach_id)`,
  `CREATE TABLE IF NOT EXISTS payment_orders (
    id text PRIMARY KEY,
    token text NOT NULL,
    ref text NOT NULL,
    coach_id text NOT NULL,
    client_id text NOT NULL,
    package_id text,
    name text NOT NULL,
    sessions integer NOT NULL DEFAULT 0,
    group_credits integer NOT NULL DEFAULT 0,
    amount_cents integer NOT NULL,
    currency text NOT NULL DEFAULT 'sgd',
    method text NOT NULL DEFAULT 'STRIPE',
    manual_kind text,
    status text NOT NULL DEFAULT 'PENDING',
    stripe_session_id text,
    payment_intent_id text,
    receipt_url text,
    applied_sessions integer NOT NULL DEFAULT 0,
    applied_group integer NOT NULL DEFAULT 0,
    note_enc text,
    created_by text NOT NULL DEFAULT 'COACH',
    expires_at timestamptz,
    paid_at timestamptz,
    refunded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_token_idx ON payment_orders (token)`,
  `CREATE INDEX IF NOT EXISTS payment_orders_coach_idx ON payment_orders (coach_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS payment_orders_client_idx ON payment_orders (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS payment_events (
    id text PRIMARY KEY,
    type text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS original_coach_id text`,
  `ALTER TABLE group_sessions ADD COLUMN IF NOT EXISTS original_coach_id text`,
];
