import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { ClientGoal, ClientProfile, UnitSystem, User } from "@/lib/types";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
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
