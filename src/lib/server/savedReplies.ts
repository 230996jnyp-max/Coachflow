import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import type { SavedReply } from "@/lib/types";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { badRequest, forbidden, notFound, str } from "./http";
import { savedReplies, type UserRow } from "./schema";

/*
 * Saved replies: short messages a coach reuses ("Great work today!"), kept per coach so they follow them to every device. Private to that
 * coach. The title and the text are encrypted together, bound to the row.
 */

const aad = (id: string) => `reply:${id}`;
const MAX_REPLIES = 30;
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

/** What a coach gets the first time they ask for suggestions. */
export const STARTERS: { title: string; text: string }[] = [
  { title: "Well done", text: "Great work today, {first_name}! Proud of the effort you put in." },
  { title: "How did it feel?", text: "How did today's session feel, {first_name}? Anything sore, or anything you want to change next time?" },
  { title: "Rebook", text: "Hi {first_name}, shall we lock in your next session? Let me know a day and time that works." },
  { title: "Gentle nudge", text: "Hi {first_name}, just checking in. How is the week going? Let me know if you need anything from me." },
];

function coachOnly(me: UserRow) {
  if (me.role === "CLIENT") throw forbidden("Saved replies are for coaches.");
}

export async function listReplies(me: UserRow): Promise<SavedReply[]> {
  coachOnly(me);
  const d = await db();
  const rows = await d.select().from(savedReplies).where(eq(savedReplies.ownerId, me.id)).orderBy(asc(savedReplies.createdAt)).limit(MAX_REPLIES);
  const out: SavedReply[] = [];
  for (const r of rows) {
    try {
      const p = decryptJson<{ title: string; text: string }>(r.dataEnc, aad(r.id));
      out.push({ id: r.id, title: p.title, text: p.text });
    } catch (e) {
      console.error("Could not decrypt saved reply", r.id, e);
    }
  }
  return out;
}

function parse(body: Record<string, unknown>): { title: string; text: string } {
  const title = str(body.title, "Title", { max: 40 });
  const text = str(body.text, "Message", { max: 500 });
  return { title, text };
}

export async function addReply(me: UserRow, body: Record<string, unknown>): Promise<SavedReply[]> {
  coachOnly(me);
  const p = parse(body);
  const d = await db();
  const [{ n }] = await d.select({ n: count() }).from(savedReplies).where(eq(savedReplies.ownerId, me.id));
  if (Number(n) >= MAX_REPLIES) throw badRequest(`You can keep up to ${MAX_REPLIES} saved replies. Remove one first.`);
  const id = `sr_${randomUUID()}`;
  await d.insert(savedReplies).values({ id, ownerId: me.id, dataEnc: encryptJson(p, aad(id)) });
  return listReplies(me);
}

export async function updateReply(me: UserRow, id: string, body: Record<string, unknown>): Promise<SavedReply[]> {
  coachOnly(me);
  if (!ID_RE.test(id)) throw notFound("That reply is gone.");
  const p = parse(body);
  const d = await db();
  const updated = await d.update(savedReplies).set({ dataEnc: encryptJson(p, aad(id)) }).where(and(eq(savedReplies.id, id), eq(savedReplies.ownerId, me.id))).returning({ id: savedReplies.id });
  if (!updated.length) throw notFound("That reply is gone.");
  return listReplies(me);
}

export async function removeReply(me: UserRow, id: string): Promise<SavedReply[]> {
  coachOnly(me);
  if (!ID_RE.test(id)) throw notFound("That reply is gone.");
  const d = await db();
  const gone = await d.delete(savedReplies).where(and(eq(savedReplies.id, id), eq(savedReplies.ownerId, me.id))).returning({ id: savedReplies.id });
  if (!gone.length) throw notFound("That reply is gone.");
  return listReplies(me);
}

/** Adds the starter replies the coach does not already have (matched by title). */
export async function addStarters(me: UserRow): Promise<SavedReply[]> {
  coachOnly(me);
  const have = new Set((await listReplies(me)).map((r) => r.title.toLowerCase()));
  const d = await db();
  let room = MAX_REPLIES - have.size;
  for (const s of STARTERS) {
    if (room <= 0 || have.has(s.title.toLowerCase())) continue;
    const id = `sr_${randomUUID()}`;
    await d.insert(savedReplies).values({ id, ownerId: me.id, dataEnc: encryptJson(s, aad(id)) });
    room--;
  }
  return listReplies(me);
}
