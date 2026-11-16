import { and, desc, gt, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { allowedThreads, hydrate, otherParty } from "@/lib/server/chat";
import { notifyByEmail, pushNewMessage, storeMessages } from "@/lib/server/chatSend";
import { db } from "@/lib/server/db";
import { forbidden, readJson, route, str, tooMany } from "@/lib/server/http";
import { smtpConfigured } from "@/lib/server/mail";
import { messages } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/chat?threads=a,b&after=ISO — messages from conversations the caller belongs to (others are silently ignored). */
export const GET = route(async (req) => {
  const me = await requireUser();
  const url = new URL(req.url);
  const requested = (url.searchParams.get("threads") ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 200);
  const allowed = await allowedThreads(me);
  const threads = requested.filter((t) => allowed.has(t));
  if (threads.length === 0) return NextResponse.json({ messages: [] });

  const afterRaw = url.searchParams.get("after");
  const after = afterRaw ? new Date(afterRaw) : null;
  const d = await db();
  const rows = await d
    .select()
    .from(messages)
    .where(after && !Number.isNaN(after.getTime()) ? and(inArray(messages.thread, threads), gt(messages.createdAt, after)) : inArray(messages.thread, threads))
    .orderBy(desc(messages.createdAt))
    .limit(600);
  rows.reverse();
  return NextResponse.json({ messages: await hydrate(rows, me.id) });
});

/** POST { thread, text, notifyEmail? } — sender is always the signed-in user; the recipient is derived from the thread. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  const thread = str(body.thread, "Conversation", { max: 80 });
  const text = str(body.text, "Message", { max: 2000 });

  const other = await otherParty(me, thread);
  if (!other) throw forbidden("You can't message in this conversation.");

  const d = await db();
  const [{ n }] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(inArray(messages.fromId, [me.id]), gt(messages.createdAt, new Date(Date.now() - 60_000))));
  if (n >= 30) throw tooMany("You're sending messages too quickly. Wait a moment.");

  const origin = process.env.APP_URL || new URL(req.url).origin;
  const email = body.notifyEmail === false ? ({ status: "off" } as const) : await notifyByEmail({ from: me, to: other, text, origin });
  const [message] = await storeMessages([{ thread, text, email }], me);
  pushNewMessage(me, [other.id], thread);
  return NextResponse.json({ message, smtp: smtpConfigured() });
});
