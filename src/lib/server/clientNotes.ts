import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { ClientNote } from "@/lib/types";
import { loadClientFor } from "./accounts";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { badRequest, forbidden, notFound, str } from "./http";
import { clientNotes, type UserRow } from "./schema";

/*
 * A coach's private notes about a client ("travelling for 2 weeks", "prefers mornings"). Only that client's coach can read or write
 * them. The client never receives them. (The medical / injuries box on the profile is separate and stays shared with the client.)
 */

const aad = (id: string) => `cnote:${id}`;
const MAX_NOTES = 200;

async function ownClient(me: UserRow, clientId: string): Promise<UserRow> {
  if (me.role === "CLIENT") throw forbidden("Notes are kept by coaches.");
  const row = await loadClientFor(me, clientId);
  if (!row) throw notFound("Client not found.");
  return row;
}

export async function listNotes(me: UserRow, clientId: string): Promise<ClientNote[]> {
  await ownClient(me, clientId);
  const d = await db();
  const rows = await d.select().from(clientNotes).where(and(eq(clientNotes.clientId, clientId), eq(clientNotes.coachId, me.id))).orderBy(desc(clientNotes.createdAt)).limit(MAX_NOTES);
  const out: ClientNote[] = [];
  for (const r of rows) {
    try {
      out.push({ id: r.id, clientId, text: decrypt(r.bodyEnc, aad(r.id)), createdAt: r.createdAt.toISOString() });
    } catch (e) {
      console.error("Could not decrypt client note", r.id, e);
    }
  }
  return out;
}

export async function addNote(me: UserRow, clientId: string, rawText: unknown): Promise<ClientNote[]> {
  await ownClient(me, clientId);
  const text = str(rawText, "Note", { max: 1000 });
  const d = await db();
  const have = await d.select({ id: clientNotes.id }).from(clientNotes).where(eq(clientNotes.clientId, clientId)).limit(MAX_NOTES + 1);
  if (have.length >= MAX_NOTES) throw badRequest("This client has reached the notes limit. Remove an old note first.");
  const id = `cn_${randomUUID()}`;
  await d.insert(clientNotes).values({ id, clientId, coachId: me.id, bodyEnc: encrypt(text, aad(id)) });
  return listNotes(me, clientId);
}

export async function removeNote(me: UserRow, clientId: string, noteId: string): Promise<ClientNote[]> {
  await ownClient(me, clientId);
  const d = await db();
  await d.delete(clientNotes).where(and(eq(clientNotes.id, noteId), eq(clientNotes.clientId, clientId), eq(clientNotes.coachId, me.id)));
  return listNotes(me, clientId);
}
