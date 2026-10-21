import "server-only";
import { randomUUID } from "node:crypto";
import type { ChatMessage } from "@/lib/types";
import { bodyAad, contactEmail, displayName, hydrate, roleLabel } from "./chat";
import { encrypt, encryptJson } from "./crypto";
import { db } from "./db";
import { escapeHtml, layout, sendMail } from "./mail";
import { messages, type UserRow } from "./schema";

export type EmailMeta = NonNullable<ChatMessage["email"]>;

/** Emails `to` a notification that `from` wrote to them. Never throws; returns delivery metadata. */
export async function notifyByEmail(opts: { from: UserRow; to: UserRow; text: string; origin: string; broadcast?: boolean }): Promise<EmailMeta> {
  const { from, to, text, origin, broadcast } = opts;
  const address = contactEmail(to);
  if (!address) return { status: "off", error: "Recipient has no email on file." };
  const fromName = displayName(from);
  const label = from.role === "OWNER" ? `${fromName} • App Owner` : from.role === "COACH" ? `Coach ${fromName.replace(/^Coach\s+/i, "")}` : fromName;
  const preview = text.length > 300 ? text.slice(0, 297) + "…" : text;
  const toFirst = displayName(to).split(" ").pop() ?? "there";
  const result = await sendMail({
    to: address,
    subject: `[CoachFlow] ${broadcast ? "Announcement from" : "New message from"} ${label}`,
    text: `Hi ${toFirst},\n\n${label} ${broadcast ? "sent an announcement to all coaches" : "sent you a message"} on CoachFlow:\n\n"${preview}"\n\nReply: ${origin}/messages\n`,
    html: layout(
      `${label} ${broadcast ? "sent an announcement" : "sent you a message"}`,
      `<p style="margin:0 0 6px;color:#8892A6;font-size:13px;">Hi ${escapeHtml(toFirst)},</p>
       <p style="margin:0 0 10px;color:#8892A6;font-size:12px;">${escapeHtml(roleLabel(from))}</p>
       <blockquote style="margin:0;padding:12px 16px;border-left:3px solid #3B82F6;background:#1A202E;border-radius:8px;color:#E8ECF4;white-space:pre-wrap;">${escapeHtml(preview)}</blockquote>`,
      { label: "Reply in CoachFlow", href: `${origin}/messages` },
    ),
  });
  return { status: result.status, to: result.to, error: result.error };
}

export function newMessageId() {
  return `msg_${randomUUID().slice(0, 12)}`;
}

/** Persists encrypted message rows (one per thread) and returns the sender's decrypted view of them. */
export async function storeMessages(entries: { thread: string; text: string; email: EmailMeta }[], from: UserRow, broadcast = false) {
  const d = await db();
  const rows = entries.map((e) => {
    const id = newMessageId();
    return {
      id,
      thread: e.thread,
      fromId: from.id,
      bodyEnc: encrypt(e.text, bodyAad(e.thread)),
      metaEnc: encryptJson(e.email, `meta:${id}`),
      broadcast,
    };
  });
  const inserted = await d.insert(messages).values(rows).returning();
  return hydrate(inserted, from.id);
}
