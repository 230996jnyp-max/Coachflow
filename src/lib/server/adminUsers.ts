import "server-only";
import { randomUUID } from "node:crypto";
import { eq, or, sql } from "drizzle-orm";
import { TRIAL_DAYS } from "@/lib/signupRules";
import { sealProfile, type ProfileJson } from "./accounts";
import { hashPassword } from "./auth";
import { markExempt, syncTier } from "./billing";
import { ensureCoachCode } from "./coachCode";
import { tempPassword } from "./crypto";
import { db } from "./db";
import { createGym } from "./gymOrg";
import { badRequest, conflict, email as parseEmail, isUniqueViolation, str } from "./http";
import { gymOrgs, users, type UserRow } from "./schema";
import { sendClientLoginEmail, sendCredentialsEmail } from "./staff";

/**
 * The owner adds someone from Admin, the short way: a name, an email, what they are, and whether they are exempt from payment. The
 * person gets a temporary password by email (and the owner sees it once) and must choose their own at first sign-in.
 *
 *  coach   a normal coach account
 *  gym     a coach account that also runs a gym (a gym_orgs row with the starter roles)
 *  solo    someone training without a coach
 *  client  a client of one of the coaches (the coach's plan covers them, so there is nothing to exempt)
 *
 * Exempt means no free month that ends and no subscription is ever asked for: a coach's billing row is marked exempt, a gym has no trial
 * end, and a solo account has no trial end (the same "no trial date" rule as the owner and the older accounts).
 */
export type AddKind = "coach" | "gym" | "solo" | "client";
export const ADD_KINDS: AddKind[] = ["coach", "gym", "solo", "client"];

export interface AddedUser {
  id: string;
  kind: AddKind;
  name: string;
  email: string;
  exempt: boolean;
  temporaryPassword: string;
  mail: { status: string; error?: string };
}

const trialEnd = () => new Date(Date.now() + TRIAL_DAYS * 86_400_000);

export async function addUser(body: Record<string, unknown>, origin: string): Promise<AddedUser> {
  const kind = body.kind as AddKind;
  if (!ADD_KINDS.includes(kind)) throw badRequest("Choose what kind of user to add.");
  const name = str(body.name, kind === "gym" ? "Contact name" : "Name", { max: 100 });
  const address = parseEmail(body.email, "Email").toLowerCase();
  const gymName = kind === "gym" ? str(body.gymName, "Gym name", { min: 2, max: 100 }) : "";
  // A client is covered by their coach, so the toggle means nothing for them.
  const exempt = kind === "client" ? false : body.exempt === true;

  const d = await db();
  let coach: UserRow | undefined;
  if (kind === "client") {
    const coachId = typeof body.coachId === "string" ? body.coachId : "";
    [coach] = coachId ? await d.select().from(users).where(eq(users.id, coachId)).limit(1) : [];
    if (!coach || (coach.role !== "COACH" && coach.role !== "OWNER")) throw badRequest("Choose which coach this client belongs to.");
  }

  const taken = await d.select({ id: users.id }).from(users).where(or(eq(users.username, address), sql`lower(${users.email}) = ${address}`)).limit(1);
  if (taken.length) throw conflict("Someone already uses that email.");

  const password = tempPassword();
  const id = `u_${randomUUID()}`;
  const isStaff = kind === "coach" || kind === "gym";
  let profile: ProfileJson | Record<string, never> = {};
  if (!isStaff) {
    profile = {
      name,
      phone: "",
      email: address,
      goal: "General Fitness",
      credits: 0,
      packageSize: 0,
      defaultGymId: null,
      medicalNotes: "",
      startDate: new Date().toISOString().slice(0, 10),
      groupClassCredits: 0,
    } satisfies ProfileJson;
  }

  let row: UserRow;
  try {
    [row] = await d
      .insert(users)
      .values({
        id,
        role: isStaff ? "COACH" : "CLIENT",
        username: address,
        passwordHash: await hashPassword(password),
        name: isStaff ? name : null,
        email: address,
        profileEnc: sealProfile(id, profile),
        coachId: coach ? coach.id : null,
        mustChangePassword: true,
        // The free month is for self sign-ups that will later pay. Exempt people (and clients, who ride on their coach) have no end date.
        trialEndsAt: !exempt && kind !== "client" ? trialEnd() : null,
      })
      .returning();
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("Someone already uses that email.");
    throw e;
  }

  try {
    if (isStaff) {
      await ensureCoachCode(row);
      if (exempt) await markExempt(id);
    }
    if (kind === "gym") {
      const gym = await createGym(row, gymName);
      if (exempt) await d.update(gymOrgs).set({ trialEndsAt: null }).where(eq(gymOrgs.id, gym.id));
    }
  } catch (e) {
    // Leave nothing half-made: a gym admin without a gym would be a broken account.
    const owned = await d.select({ id: gymOrgs.id }).from(gymOrgs).where(eq(gymOrgs.ownerId, id));
    if (owned.length) {
      const { deleteGymEverything } = await import("./gymOrg");
      for (const g of owned) await deleteGymEverything(g.id);
    }
    await d.delete(users).where(eq(users.id, id));
    throw e;
  }

  // A new client changes the coach's roster size, and so the price from the next renewal.
  if (coach) void syncTier(coach.id).catch(() => undefined);

  const mail =
    kind === "client" && coach
      ? await sendClientLoginEmail({ to: address, name, coachName: coach.name ?? "Your coach", username: address, password, origin })
      : await sendCredentialsEmail({ to: address, name, username: address, password, origin, noun: kind === "gym" ? "gym" : kind === "solo" ? "training" : "coach" });
  return { id, kind, name, email: address, exempt, temporaryPassword: password, mail: { status: mail.status, error: mail.error } };
}

