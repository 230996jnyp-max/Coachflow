import "server-only";
import { and, eq } from "drizzle-orm";
import type { ChatMessage, ChatRole } from "@/lib/types";
import { loadClientFor, openProfile, usersByIds } from "./accounts";
import { decrypt, decryptJson } from "./crypto";
import { db } from "./db";
import { users, type MessageRow, type UserRow } from "./schema";

/*
 * Conversations ("threads"):
 *   c:<clientId>  coach ↔ client   (visible only to that client and the client's coach)
 *   o:<coachId>   owner ↔ coach    (visible only to the owner and that coach)
 * Message bodies are AES-256-GCM encrypted with the thread id as authenticated data.
 */

export const bodyAad = (thread: string) => `msg:${thread}`;

export async function allowedThreads(me: UserRow): Promise<Set<string>> {
  const d = await db();
  if (me.role === "CLIENT") return new Set([`c:${me.id}`]);
  const set = new Set<string>();
  const mine = await d.select({ id: users.id }).from(users).where(and(eq(users.role, "CLIENT"), eq(users.coachId, me.id)));
  for (const c of mine) set.add(`c:${c.id}`);
  if (me.role === "OWNER") {
    const coaches = await d.select({ id: users.id }).from(users).where(eq(users.role, "COACH"));
    for (const c of coaches) set.add(`o:${c.id}`);
  } else {
    set.add(`o:${me.id}`);
  }
  return set;
}

/** The person on the other end of `thread` from `me`, or null when `me` has no access to it. */
export async function otherParty(me: UserRow, thread: string): Promise<UserRow | null> {
  const [kind, id] = thread.split(":");
  if (!id) return null;
  const d = await db();
  if (kind === "c") {
    const client = await loadClientFor(me, id);
    if (!client) return null;
    if (me.role === "CLIENT") {
      if (!client.coachId) return null;
      const [coach] = await d.select().from(users).where(eq(users.id, client.coachId)).limit(1);
      return coach ?? null;
    }
    return client;
  }
  if (kind === "o") {
    const [coach] = await d.select().from(users).where(and(eq(users.id, id), eq(users.role, "COACH"))).limit(1);
    if (!coach) return null;
    if (me.role === "OWNER") return coach;
    if (me.id === coach.id) {
      const [owner] = await d.select().from(users).where(eq(users.role, "OWNER")).limit(1);
      return owner ?? null;
    }
  }
  return null;
}

export function displayName(row: UserRow): string {
  if (row.role === "CLIENT") {
    try {
      return openProfile(row).name;
    } catch {
      return row.username;
    }
  }
  return row.name ?? row.username;
}

export function contactEmail(row: UserRow): string {
  if (row.role === "CLIENT") {
    try {
      return openProfile(row).email;
    } catch {
      return "";
    }
  }
  return row.email ?? "";
}

/** Decrypts rows into the shape the browser expects. Email metadata is only revealed to the sender. */
export async function hydrate(rows: MessageRow[], viewerId: string): Promise<ChatMessage[]> {
  const senders = new Map((await usersByIds([...new Set(rows.map((r) => r.fromId))])).map((u) => [u.id, u]));
  const out: ChatMessage[] = [];
  for (const r of rows) {
    try {
      const sender = senders.get(r.fromId);
      let email: ChatMessage["email"];
      if (r.fromId === viewerId && r.metaEnc) email = decryptJson<NonNullable<ChatMessage["email"]>>(r.metaEnc, `meta:${r.id}`);
      out.push({
        id: r.id,
        thread: r.thread,
        fromId: r.fromId,
        fromRole: ((sender?.role as ChatRole | undefined) ?? "CLIENT"),
        fromName: sender ? displayName(sender) : "Former member",
        text: decrypt(r.bodyEnc, bodyAad(r.thread)),
        createdAt: r.createdAt.toISOString(),
        broadcast: r.broadcast || undefined,
        email,
      });
    } catch (e) {
      console.error("Could not decrypt message", r.id, e);
    }
  }
  return out;
}

export const roleLabel = (row: UserRow) => (row.role === "OWNER" ? "App Owner" : row.role === "COACH" ? "Coach" : "Client");
