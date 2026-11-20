import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/*
 * Tables for programs and Autopilot. They live in their own file (not schema.ts) so they never collide with other work on the main
 * schema; db.ts runs FLOW_DDL right after the main DDL. Everything personal is encrypted in `data_enc`, bound to the row.
 */

/** A multi-week program (name, description and every workout, encrypted). Owned by a coach, or by a person training on their own. */
export const programs = pgTable(
  "programs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    weeks: integer("weeks").notNull().default(4),
    /** Goes up on every change, so Live Sync knows who is behind. */
    version: integer("version").notNull().default(1),
    dataEnc: text("data_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("programs_owner_idx").on(t.ownerId)],
);

/** A program given to one client from a start date. Its workouts are rows in `assignments` marked with this enrolment. */
export const programEnrolments = pgTable(
  "program_enrolments",
  {
    id: text("id").primaryKey(),
    programId: text("program_id").notNull(),
    clientId: text("client_id").notNull(),
    /** The coach who assigned it (the person themselves when they train on their own). */
    ownerId: text("owner_id").notNull(),
    startDate: text("start_date").notNull(),
    liveSync: boolean("live_sync").notNull().default(true),
    status: text("status").notNull().default("ACTIVE"),
    appliedVersion: integer("applied_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("program_enrolments_client_idx").on(t.clientId, t.status), index("program_enrolments_program_idx").on(t.programId, t.status), index("program_enrolments_owner_idx").on(t.ownerId, t.status)],
);

/** A Monday suggestion for one client on a program ("add 2.5 kg to bench"), waiting for the coach's tap. Never applied on its own. */
export const programSuggestions = pgTable(
  "program_suggestions",
  {
    id: text("id").primaryKey(),
    enrolmentId: text("enrolment_id").notNull(),
    clientId: text("client_id").notNull(),
    ownerId: text("owner_id").notNull(),
    /** The Monday (yyyy-MM-dd) of the week the changes are for. */
    weekStart: text("week_start").notNull(),
    status: text("status").notNull().default("PENDING"),
    dataEnc: text("data_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("program_suggestions_week_uq").on(t.enrolmentId, t.weekStart), index("program_suggestions_owner_idx").on(t.ownerId, t.status)],
);

/** One Autopilot rule per trigger per coach: on or off, automatic or drafted, and what it does (encrypted). */
export const autopilotRules = pgTable(
  "autopilot_rules",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    trigger: text("trigger").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** "auto" sends by itself, "draft" waits for the coach. */
    mode: text("mode").notNull().default("draft"),
    dataEnc: text("data_enc").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("autopilot_rules_owner_trigger_uq").on(t.ownerId, t.trigger)],
);

/**
 * What Autopilot did or wants to do for a client: the activity log, the drafts waiting for approval and the messages held for the morning.
 * (owner, client, trigger, event key) is unique, so an event can only ever produce one entry.
 */
export const autopilotEvents = pgTable(
  "autopilot_events",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    clientId: text("client_id").notNull(),
    trigger: text("trigger").notNull(),
    eventKey: text("event_key").notNull(),
    /** DRAFT, HELD, SENT, DISMISSED or FAILED. */
    status: text("status").notNull(),
    dataEnc: text("data_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("autopilot_events_uq").on(t.ownerId, t.clientId, t.trigger, t.eventKey), index("autopilot_events_owner_idx").on(t.ownerId, t.status, t.createdAt), index("autopilot_events_client_idx").on(t.clientId, t.createdAt)],
);

/** A coach's smart-reply settings: switched on or not, and the tone. */
export const smartReplySettings = pgTable("smart_reply_settings", {
  ownerId: text("owner_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  tone: text("tone").notNull().default("casual"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const FLOW_DDL = [
  `CREATE TABLE IF NOT EXISTS programs (id text PRIMARY KEY, owner_id text NOT NULL, weeks integer NOT NULL DEFAULT 4, version integer NOT NULL DEFAULT 1, data_enc text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS programs_owner_idx ON programs (owner_id)`,
  `CREATE TABLE IF NOT EXISTS program_enrolments (id text PRIMARY KEY, program_id text NOT NULL, client_id text NOT NULL, owner_id text NOT NULL, start_date text NOT NULL, live_sync boolean NOT NULL DEFAULT true, status text NOT NULL DEFAULT 'ACTIVE', applied_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz)`,
  `CREATE INDEX IF NOT EXISTS program_enrolments_client_idx ON program_enrolments (client_id, status)`,
  `CREATE INDEX IF NOT EXISTS program_enrolments_program_idx ON program_enrolments (program_id, status)`,
  `CREATE INDEX IF NOT EXISTS program_enrolments_owner_idx ON program_enrolments (owner_id, status)`,
  `CREATE TABLE IF NOT EXISTS program_suggestions (id text PRIMARY KEY, enrolment_id text NOT NULL, client_id text NOT NULL, owner_id text NOT NULL, week_start text NOT NULL, status text NOT NULL DEFAULT 'PENDING', data_enc text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS program_suggestions_week_uq ON program_suggestions (enrolment_id, week_start)`,
  `CREATE INDEX IF NOT EXISTS program_suggestions_owner_idx ON program_suggestions (owner_id, status)`,
  `CREATE TABLE IF NOT EXISTS autopilot_rules (id text PRIMARY KEY, owner_id text NOT NULL, trigger text NOT NULL, enabled boolean NOT NULL DEFAULT false, mode text NOT NULL DEFAULT 'draft', data_enc text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS autopilot_rules_owner_trigger_uq ON autopilot_rules (owner_id, trigger)`,
  `CREATE TABLE IF NOT EXISTS autopilot_events (id text PRIMARY KEY, owner_id text NOT NULL, client_id text NOT NULL, trigger text NOT NULL, event_key text NOT NULL, status text NOT NULL, data_enc text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS autopilot_events_uq ON autopilot_events (owner_id, client_id, trigger, event_key)`,
  `CREATE INDEX IF NOT EXISTS autopilot_events_owner_idx ON autopilot_events (owner_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS autopilot_events_client_idx ON autopilot_events (client_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS smart_reply_settings (owner_id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false, tone text NOT NULL DEFAULT 'casual', updated_at timestamptz NOT NULL DEFAULT now())`,
];
