import "server-only";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { ClientGoal, ClientProfile, PlaceInfo, UnitSystem, User } from "@/lib/types";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { ageOn, isMinorAge, trialDaysLeft, trialOver } from "@/lib/signupRules";
import { parsePrefs, publicPrefs } from "@/lib/prefs";
import { trialEnforced } from "./trial";
import { ensureCoachCode } from "./coachCode";
import { badRequest, conflict, int, isUniqueViolation, str } from "./http";
import { users, type UserRow } from "./schema";

/** Everything private about a client, stored encrypted in users.profile_enc. */
export interface ProfileJson {
  name: string;
  phone: string;
  email: string;
  goal: ClientGoal;
  credits: number;
  packageSize: number;
  defaultGymId: string | null;
  medicalNotes: string;
  startDate: string;
  /** Group-class credits (older profiles do not have the field yet: read it with `?? 0`). */
  groupClassCredits?: number;
  /** The last day the package can be used (yyyy-MM-dd), set by the coach. Clients and coach are told a week before and the day before. */
  packageExpires?: string;
  /** Home address for sessions at the client's home (a picked place, or typed text). */
  homePlace?: PlaceInfo;
  homeText?: string;
  /** Training focuses the coach assigned (sport names). */
  focuses?: string[];
  /** Self sign-ups: birth date (YYYY-MM-DD), experience, weekly training target, starting body weight (kg) and what they are working towards. */
  dob?: string;
  level?: string;
  weeklyTarget?: number;
  startWeightKg?: number;
  personalGoal?: string;
  /** The event they are working towards and its date (yyyy-MM-dd): the countdown on their dashboard. */
  goalEventName?: string;
  goalEventDate?: string;
  /** When they accepted the Terms and Privacy Policy, and (13 to 17) that a parent or guardian agrees. */
  consent?: { at: string; guardian?: boolean };
  /** A client who signed up with a coach's code: the coach to ask once their email is confirmed. */
  pendingCoachId?: string;
}

/** What a coach's sealed profile holds (their name and email are plain columns). */
export interface StaffProfileJson {
  phone?: string;
  dob?: string;
  experienceYears?: number;
  tagline?: string;
  consent?: { at: string };
  /** A gym code typed at sign-up: used once the email is confirmed. */
  pendingGymCode?: string;
}

export const GOALS: ClientGoal[] = ["Hypertrophy", "Fat Loss", "Strength", "Conditioning", "General Fitness"];

const aad = (id: string) => `profile:${id}`;

export const sealProfile = (id: string, p: ProfileJson | StaffProfileJson | Record<string, never>) => encryptJson(p, aad(id));

export function openProfile(row: UserRow): ProfileJson {
  return decryptJson<ProfileJson>(row.profileEnc, aad(row.id));
}

export function openStaffProfile(row: UserRow): StaffProfileJson {
  return decryptJson<StaffProfileJson>(row.profileEnc, aad(row.id));
}

/** Their date of birth, when they gave one (self sign-ups). Never throws. */
export function dobOf(row: UserRow): string | null {
  try {
    const p = decryptJson<{ dob?: string }>(row.profileEnc, aad(row.id));
    return p.dob ?? null;
  } catch {
    return null;
  }
}

/** Under 18 (only known when they gave a birth date). Minors get no calorie targets and no AI features. */
export const isMinorRow = (row: UserRow): boolean => isMinorAge(ageOn(dobOf(row)));

/** A client with no coach: someone training on their own ("Personal"). Accepted by a coach later, they become that coach's client. */
export const isPersonalRow = (row: UserRow): boolean => row.role === "CLIENT" && !row.coachId;

export const isClientRow = (r: UserRow) => r.role === "CLIENT";

/** Public/user-facing shape. Clients' names come from the encrypted profile; staff names are plaintext. */
export function toUser(row: UserRow, opts: { withEmail?: boolean; self?: boolean } = {}): User {
  const staff = row.role !== "CLIENT";
  const profile = staff ? null : openProfile(row);
  const prefs = opts.self ? parsePrefs(row.prefs) : publicPrefs(parsePrefs(row.prefs));
  return {
    id: row.id,
    role: staff ? "TRAINER" : "CLIENT",
    username: row.username,
    name: staff ? (row.name ?? row.username) : (profile?.name ?? row.username),
    mustChangePassword: row.mustChangePassword,
    unit: (row.unit === "imperial" ? "imperial" : "metric") as UnitSystem,
    createdAt: row.createdAt.toISOString(),
    isOwner: row.role === "OWNER",
    active: row.active,
    hasCompletedOnboarding: row.onboarded,
    ...(row.theme === "black" || row.theme === "white" || row.theme === "navy" ? { themePreference: row.theme } : {}),
    ...(opts.withEmail && staff && row.email ? { email: row.email } : {}),
    ...(row.role === "CLIENT" && !row.coachId ? { personal: true } : {}),
    ...(isMinorRow(row) ? { isMinor: true } : {}),
    ...(Object.keys(prefs).length ? { prefs } : {}),
    ...(opts.withEmail && row.coachCode ? { coachCode: row.coachCode } : {}),
    ...(opts.withEmail && row.trialEndsAt
      ? { trial: { endsAt: row.trialEndsAt.toISOString(), daysLeft: trialDaysLeft(row.trialEndsAt) ?? 0, expired: trialOver(row.trialEndsAt), enforced: trialEnforced() } }
      : {}),
  };
}

export function toProfile(row: UserRow): ClientProfile {
  const p = openProfile(row);
  return {
    id: row.id,
    phone: p.phone,
    email: p.email,
    goal: p.goal,
    credits: p.credits,
    packageSize: p.packageSize,
    defaultGymId: p.defaultGymId,
    medicalNotes: p.medicalNotes,
    archived: !row.active,
    startDate: p.startDate,
    coachId: row.coachId ?? "",
    groupClassCredits: p.groupClassCredits ?? 0,
    ...(p.packageExpires ? { packageExpires: p.packageExpires } : {}),
    ...(p.homePlace ? { homePlace: p.homePlace } : {}),
    ...(p.homeText ? { homeText: p.homeText } : {}),
    ...(p.focuses?.length ? { focuses: p.focuses } : {}),
    ...(p.level ? { level: p.level } : {}),
    ...(p.weeklyTarget ? { weeklyTarget: p.weeklyTarget } : {}),
    ...(p.personalGoal ? { personalGoal: p.personalGoal } : {}),
    ...(p.startWeightKg ? { startWeightKg: p.startWeightKg } : {}),
    ...(p.goalEventName ? { goalEventName: p.goalEventName } : {}),
    ...(p.goalEventDate ? { goalEventDate: p.goalEventDate } : {}),
  };
}

/**
 * Applies the goal fields found in `src` to a profile: `personalGoal` (what they are working towards), `goalEventName` and
 * `goalEventDate` (yyyy-MM-dd, a real date), and `weeklyTarget` (1 to 7 sessions a week). Empty text clears a field. Returns true
 * when anything was present.
 */
export function applyGoalFields(p: ProfileJson, src: Record<string, unknown>): boolean {
  let any = false;
  const text = (key: "personalGoal" | "goalEventName", label: string, max: number) => {
    if (!(key in src)) return;
    any = true;
    const v = str(src[key], label, { optional: true, max });
    if (v) p[key] = v;
    else delete p[key];
  };
  text("personalGoal", "Goal", 200);
  text("goalEventName", "Event", 80);
  if ("goalEventDate" in src) {
    any = true;
    const raw = src.goalEventDate;
    if (raw === "" || raw === null) delete p.goalEventDate;
    else {
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest("The event date should be a real date.");
      const d = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) throw badRequest("The event date should be a real date.");
      p.goalEventDate = raw;
    }
  }
  if ("weeklyTarget" in src) {
    any = true;
    p.weeklyTarget = int(src.weeklyTarget, "Weekly target", 1, 7);
  }
  // An event date with no name is fine; a name with no date is just a label. Dropping both leaves nothing behind.
  return any;
}

/** Rows the viewer may see, decrypted into the shapes the app's local store expects. */
export async function bootstrapFor(me: UserRow): Promise<{ me: User; users: User[]; clients: ClientProfile[] }> {
  const d = await db();
  // Coaches who existed before coach codes get theirs the first time they load the app.
  if ((me.role === "COACH" || me.role === "OWNER") && !me.coachCode) me = { ...me, coachCode: await ensureCoachCode(me) };
  const out: User[] = [toUser(me, { withEmail: true, self: true })];
  const profiles: ClientProfile[] = [];

  // Loaded here, not at the top of the file, because the gym modules import this one.
  const { gymInfoFor, publicGymOf } = await import("./gymOrg");

  if (me.role === "CLIENT") {
    if (me.coachId) {
      const [coach] = await d.select().from(users).where(eq(users.id, me.coachId)).limit(1);
      if (coach) {
        const u = toUser(coach);
        // The coach's gym (name and logo) shows on their client's home screen.
        const gym = await publicGymOf(coach.id);
        out.push(gym ? { ...u, publicGym: gym } : u);
      }
    }
    profiles.push(toProfile(me));
    // Forms still to fill in and copies to acknowledge ("Before we meet"). A reminder goes out when a session is near and forms are owed.
    try {
      const { intakeTodoFor, sendIntakeReminders } = await import("./intake");
      await sendIntakeReminders({ clientId: me.id });
      const todo = await intakeTodoFor(me);
      if (todo.hasRequest || todo.toAcknowledge) out[0] = { ...out[0], intake: { missing: todo.missing, toAcknowledge: todo.toAcknowledge } };
    } catch (e) {
      console.error("intake todo failed", e);
    }
    return { me: out[0], users: out, clients: profiles };
  }

  // A coach in a gym: their role, permissions and the gym's free month (which replaces their own).
  const gym = await gymInfoFor(me.id);
  if (gym) out[0] = { ...out[0], gym, ...(gym.trial ? { trial: gym.trial } : {}) };

  // Staff: their own clients only, plus the clients of any session or class they are covering for their gym.
  const { coverClientIds } = await import("./gymCover");
  const covering = await coverClientIds(me.id);
  const mine = await d
    .select()
    .from(users)
    .where(and(eq(users.role, "CLIENT"), covering.length ? or(eq(users.coachId, me.id), inArray(users.id, covering)) : eq(users.coachId, me.id)));
  for (const r of mine) {
    try {
      out.push(toUser(r));
      profiles.push(toProfile(r));
    } catch (e) {
      console.error("Could not decrypt client row", r.id, e);
    }
  }
  // Counts for the "Needs you" list and the client page: health flags, forms owed, self-assessments handed in (never the answers).
  try {
    const { intakeFlagsFor, sendIntakeReminders } = await import("./intake");
    const { unseenSelfAssessments } = await import("./assessments");
    await sendIntakeReminders({ coachId: me.id });
    const [flags, unseen] = await Promise.all([intakeFlagsFor(me.id), unseenSelfAssessments(me.id)]);
    for (const p of profiles) {
      const f = flags[p.id];
      const s = unseen[p.id] ?? 0;
      if (f || s) p.intake = { healthFlags: f?.healthFlags ?? 0, needsReview: f?.needsReview ?? false, pending: f?.pending ?? false, selfAssessments: s };
    }
  } catch (e) {
    console.error("intake flags failed", e);
  }
  if (me.role === "COACH") {
    const [owner] = await d.select().from(users).where(eq(users.role, "OWNER")).limit(1);
    if (owner) out.push(toUser(owner));
  } else {
    const coaches = await d.select().from(users).where(eq(users.role, "COACH"));
    for (const c of coaches) out.push(toUser(c, { withEmail: true }));
  }
  return { me: out[0], users: out, clients: profiles };
}

/** Loads a client row only if `viewer` is that client's coach (or the client). */
export async function loadClientFor(viewer: UserRow, clientId: string): Promise<UserRow | null> {
  const d = await db();
  const [row] = await d.select().from(users).where(and(eq(users.id, clientId), eq(users.role, "CLIENT"))).limit(1);
  if (!row) return null;
  if (viewer.role === "CLIENT") return viewer.id === row.id ? row : null;
  return row.coachId === viewer.id ? row : null;
}

export async function usersByIds(ids: string[]): Promise<UserRow[]> {
  if (ids.length === 0) return [];
  const d = await db();
  return d.select().from(users).where(inArray(users.id, ids));
}

/**
 * A username: 3-32 letters, numbers, dots, dashes and underscores. Staff may also keep an email-style one (letters, numbers and
 * . _ @ + - up to 100), because that is what coaches sign in with today.
 */
export function parseUsername(raw: unknown, staff: boolean): string {
  const u = str(raw, "Username", { min: 3, max: staff ? 100 : 32 }).toLowerCase();
  if (!(staff ? /^[a-z0-9_.@+-]+$/ : /^[a-z0-9_.-]+$/).test(u)) throw badRequest("Username can only use letters, numbers, dots, dashes and underscores.");
  return u;
}

/** Is this name (as a username, or as somebody's sign-in email) already in use by someone else? */
export async function usernameTaken(username: string, exceptId: string): Promise<boolean> {
  const d = await db();
  const rows = await d
    .select({ id: users.id })
    .from(users)
    .where(and(ne(users.id, exceptId), or(eq(users.username, username), sql`lower(${users.email}) = ${username}`)))
    .limit(1);
  return rows.length > 0;
}

/** Changes a username after checking it is free. Sessions stay signed in; only the sign-in name changes. */
export async function setUsername(targetId: string, username: string): Promise<void> {
  if (await usernameTaken(username, targetId)) throw conflict("That username is already taken.");
  const d = await db();
  try {
    await d.update(users).set({ username, updatedAt: new Date() }).where(eq(users.id, targetId));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("That username is already taken.");
    throw e;
  }
}
