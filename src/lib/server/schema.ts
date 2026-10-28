import { boolean, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_coach_idx").on(t.coachId), index("users_role_idx").on(t.role)],
);

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

export type UserRow = typeof users.$inferSelect;
export type AttendanceRow = typeof attendance.$inferSelect;
export type GroupRow = typeof groupSessions.$inferSelect;
export type GroupMemberRow = typeof groupMembers.$inferSelect;
export type GroupRequestRow = typeof groupRequests.$inferSelect;
export type WorkoutRow = typeof workouts.$inferSelect;
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
];
