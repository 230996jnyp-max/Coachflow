import { createEmptyDB } from "./seed";
import type { Booking, ClientProfile, DB, GroupSession, User } from "./types";

/*
 * The copy of a person's own data that is kept on their phone so CoachFlow opens with no signal (a basement gym): their workouts,
 * routines and plan, upcoming sessions, check-ins. It holds what that person may see and nothing more: other people's contact details,
 * health notes, class rosters and session notes are left out, and progress photos are never part of it.
 * The copy is replaced each time the app loads and is deleted when the person signs out on purpose.
 */

export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  v: number;
  userId: string;
  savedAt: number;
  db: DB;
}

const DAY = 86_400_000;
const KEEP_WORKOUT_DAYS = 120;
const KEEP_WORKOUTS = 300;
const KEEP_CHECKINS = 400;
const KEEP_NOTES = 20;

/** Another person as the phone keeps them: a name to show on a session, nothing to contact them with. */
function minimalUser(u: User): User {
  return { id: u.id, role: u.role, username: u.username, name: u.name, mustChangePassword: false, unit: u.unit, createdAt: u.createdAt, ...(u.isOwner ? { isOwner: true } : {}), ...(u.publicGym ? { publicGym: u.publicGym } : {}) };
}

/** The person's own client record, without the contact and health details the screens never need offline. */
function ownProfile(c: ClientProfile): ClientProfile {
  const { homePlace: _homePlace, homeText: _homeText, ...rest } = c;
  void _homePlace;
  void _homeText;
  return { ...rest, phone: "", email: "", medicalNotes: "" };
}

/** What to keep from the current local database, or null when there is nothing worth keeping (not signed in, or nothing loaded yet). */
export function buildSnapshot(db: DB, meId: string, now = Date.now()): Snapshot | null {
  const me = db.users.find((u) => u.id === meId);
  if (!me) return null;
  const staff = me.role === "TRAINER";
  const since = now - KEEP_WORKOUT_DAYS * DAY;
  const recent = (iso: string) => Date.parse(iso) >= now - 2 * DAY;

  const workouts = db.workouts
    .filter((w) => w.clientId === meId && (w.status === "ACTIVE" || Date.parse(w.startedAt) >= since))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, KEEP_WORKOUTS);

  const bookings: Booking[] = db.bookings
    .filter((b) => recent(b.end))
    .map((b) => (staff ? { ...b, notes: "", place: undefined, customGym: undefined } : b));
  const groups: GroupSession[] = db.groups.filter((g) => recent(g.end)).map((g) => {
    const { members: _members, ...rest } = g;
    void _members;
    return rest;
  });

  // People shown on kept sessions: a client sees their coach(es); a coach sees the clients who have a session coming up.
  const clientIds = new Set(bookings.map((b) => b.clientId));
  const others = db.users.filter((u) => u.id !== meId && (staff ? clientIds.has(u.id) : u.role === "TRAINER")).map(minimalUser);

  return {
    v: SNAPSHOT_VERSION,
    userId: meId,
    savedAt: now,
    db: {
      version: db.version,
      users: [me, ...others],
      clients: staff ? [] : db.clients.filter((c) => c.id === meId).map(ownProfile),
      exercises: db.exercises.filter((e) => e.custom || e.global),
      tracking: db.tracking,
      workouts,
      templates: db.templates.filter((t) => (staff ? t.ownerId === meId : true)),
      metrics: db.metrics.filter((m) => m.clientId === meId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, KEEP_CHECKINS),
      photos: [],
      gyms: db.gyms,
      slots: db.slots,
      bookings,
      groups,
      groupRequests: db.groupRequests.filter((r) => r.mine),
      notifications: staff ? [] : [...db.notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, KEEP_NOTES),
      assignments: staff ? [] : db.assignments.filter((a) => a.clientId === meId),
      settings: db.settings,
    },
  };
}

/** A full local database from a kept copy (any piece the copy lacks is an empty one). Null when the copy is from a different version. */
export function dbFromSnapshot(s: Snapshot | undefined | null): DB | null {
  if (!s || s.v !== SNAPSHOT_VERSION || !s.db || !Array.isArray(s.db.users) || !s.db.users.some((u) => u.id === s.userId)) return null;
  const empty = createEmptyDB();
  return { ...empty, ...s.db, settings: { ...empty.settings, ...s.db.settings } };
}
