import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { shortName } from "@/lib/signupRules";
import { openProfile } from "./accounts";
import { db } from "./db";
import { conflict, forbidden, notFound } from "./http";
import { notify } from "./groups";
import { onClientAccepted } from "./referrals";
import { coachLinks, users, type UserRow } from "./schema";

/*
 * Joining a coach. Anyone who signed up on their own is "Personal" (a client with no coach). They ask a coach by typing the coach's
 * six-digit code; nothing of theirs is shared until that coach accepts. Accepting makes them the coach's client (no session credits
 * until the coach adds some). Declining leaves them as they were.
 */

export interface LinkRequest {
  id: string;
  clientId: string;
  name: string;
  goal: string;
  level: string;
  requestedAt: string;
}

const nameOf = (row: UserRow): string => {
  try {
    return openProfile(row).name || row.username;
  } catch {
    return row.username;
  }
};

/** Asks `coach` to take `client` on. Replaces any request the client already had waiting. */
export async function requestCoach(client: UserRow, coach: UserRow): Promise<void> {
  if (client.role !== "CLIENT") throw forbidden("Only a client account can ask a coach.");
  if (client.coachId) throw conflict("You already have a coach.");
  if ((coach.role !== "COACH" && coach.role !== "OWNER") || !coach.active) throw notFound("We couldn't find a coach with that code.");
  const d = await db();
  await d
    .update(coachLinks)
    .set({ status: "CANCELLED", decidedAt: new Date() })
    .where(and(eq(coachLinks.clientId, client.id), eq(coachLinks.status, "PENDING")));
  await d.insert(coachLinks).values({ id: `cl_${randomUUID()}`, clientId: client.id, coachId: coach.id });
  await notify([coach.id], "coach_request", { title: "New client request", body: `${nameOf(client)} would like to train with you. Accept or decline on your Clients page.`, link: "/clients" });
}

/** The people waiting for this coach to answer (only accounts whose email is confirmed and who still have no coach). */
export async function pendingFor(coach: UserRow): Promise<LinkRequest[]> {
  const d = await db();
  const rows = await d
    .select({ link: coachLinks, user: users })
    .from(coachLinks)
    .innerJoin(users, eq(users.id, coachLinks.clientId))
    .where(and(eq(coachLinks.coachId, coach.id), eq(coachLinks.status, "PENDING"), eq(users.emailVerified, true), eq(users.active, true), isNull(users.coachId)))
    .orderBy(desc(coachLinks.createdAt))
    .limit(50);
  const out: LinkRequest[] = [];
  for (const { link, user } of rows) {
    try {
      const p = openProfile(user);
      out.push({ id: link.id, clientId: user.id, name: p.name || user.username, goal: p.personalGoal || p.goal, level: p.level ?? "", requestedAt: link.createdAt.toISOString() });
    } catch {
      /* unreadable row: skip */
    }
  }
  return out;
}

/** The request this client has waiting, with the coach's short name. */
export async function pendingOf(client: UserRow): Promise<{ id: string; coachName: string } | null> {
  const d = await db();
  const [row] = await d
    .select({ id: coachLinks.id, coachId: coachLinks.coachId })
    .from(coachLinks)
    .where(and(eq(coachLinks.clientId, client.id), eq(coachLinks.status, "PENDING")))
    .orderBy(desc(coachLinks.createdAt))
    .limit(1);
  if (!row) return null;
  const [coach] = await d.select().from(users).where(eq(users.id, row.coachId)).limit(1);
  return { id: row.id, coachName: coach ? shortName(coach.name ?? coach.username) : "your coach" };
}

/** Takes back the request this client has waiting. */
export async function cancelMine(client: UserRow): Promise<void> {
  const d = await db();
  await d
    .update(coachLinks)
    .set({ status: "CANCELLED", decidedAt: new Date() })
    .where(and(eq(coachLinks.clientId, client.id), eq(coachLinks.status, "PENDING")));
}

/** The coach's answer. Accepting links the client to the coach; two coaches can't both win, and the client's other requests close. */
export async function decide(coach: UserRow, linkId: string, accept: boolean): Promise<void> {
  const d = await db();
  const [done] = await d
    .update(coachLinks)
    .set({ status: accept ? "ACCEPTED" : "DECLINED", decidedAt: new Date() })
    .where(and(eq(coachLinks.id, linkId), eq(coachLinks.coachId, coach.id), eq(coachLinks.status, "PENDING")))
    .returning();
  if (!done) throw notFound("That request is no longer waiting.");
  const [client] = await d.select().from(users).where(eq(users.id, done.clientId)).limit(1);
  const coachName = shortName(coach.name ?? coach.username);

  if (!accept) {
    if (client) await notify([client.id], "coach_declined", { title: "Coach request", body: `${coachName} can't take you on right now. You can keep training on your own, or ask another coach.`, link: "/settings" });
    return;
  }
  // Their free month is replaced by the coach's own subscription.
  const [linked] = await d
    .update(users)
    .set({ coachId: coach.id, trialEndsAt: null, updatedAt: new Date() })
    .where(and(eq(users.id, done.clientId), isNull(users.coachId), eq(users.active, true)))
    .returning({ id: users.id });
  if (!linked) {
    await d.update(coachLinks).set({ status: "CANCELLED" }).where(eq(coachLinks.id, linkId));
    throw conflict("That person already joined another coach, or closed their account.");
  }
  await d
    .update(coachLinks)
    .set({ status: "CANCELLED", decidedAt: new Date() })
    .where(and(eq(coachLinks.clientId, done.clientId), eq(coachLinks.status, "PENDING")));
  await notify([done.clientId], "coach_accepted", { title: "You're in!", body: `${coachName} accepted you. You can now book sessions and chat with your coach.`, link: "/home" });
  await onClientAccepted(done.clientId, coach); // a friend of one of this coach's clients: the client earns what the coach has set
}
