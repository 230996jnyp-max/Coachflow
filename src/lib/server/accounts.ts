import "server-only";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { ClientGoal, ClientProfile, PlaceInfo, UnitSystem, User } from "@/lib/types";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { badRequest, conflict, isUniqueViolation, str } from "./http";
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
  /** Home address for sessions at the client's home (a picked place, or typed text). */
  homePlace?: PlaceInfo;
  homeText?: string;
  /** Training focuses the coach assigned (sport names). */
  focuses?: string[];
}

export const GOALS: ClientGoal[] = ["Hypertrophy", "Fat Loss", "Strength", "Conditioning", "General Fitness"];

const aad = (id: string) => `profile:${id}`;

export const sealProfile = (id: string, p: ProfileJson | Record<string, never>) => encryptJson(p, aad(id));

export function openProfile(row: UserRow): ProfileJson {
  return decryptJson<ProfileJson>(row.profileEnc, aad(row.id));
}

export const isClientRow = (r: UserRow) => r.role === "CLIENT";

/** Public/user-facing shape. Clients' names come from the encrypted profile; staff names are plaintext. */
export function toUser(row: UserRow, opts: { withEmail?: boolean } = {}): User {
  const staff = row.role !== "CLIENT";
  const profile = staff ? null : openProfile(row);
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
    ...(p.homePlace ? { homePlace: p.homePlace } : {}),
    ...(p.homeText ? { homeText: p.homeText } : {}),
    ...(p.focuses?.length ? { focuses: p.focuses } : {}),
  };
}

/** Rows the viewer may see, decrypted into the shapes the app's local store expects. */
export async function bootstrapFor(me: UserRow): Promise<{ me: User; users: User[]; clients: ClientProfile[] }> {
  const d = await db();
  const out: User[] = [toUser(me, { withEmail: true })];
  const profiles: ClientProfile[] = [];

  if (me.role === "CLIENT") {
    if (me.coachId) {
      const [coach] = await d.select().from(users).where(eq(users.id, me.coachId)).limit(1);
      if (coach) out.push(toUser(coach));
    }
    profiles.push(toProfile(me));
    return { me: out[0], users: out, clients: profiles };
  }

  // Staff: their own clients only.
  const mine = await d.select().from(users).where(and(eq(users.role, "CLIENT"), eq(users.coachId, me.id)));
  for (const r of mine) {
    try {
      out.push(toUser(r));
      profiles.push(toProfile(r));
    } catch (e) {
      console.error("Could not decrypt client row", r.id, e);
    }
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
