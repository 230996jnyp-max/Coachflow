import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { notifyByEmail, storeMessages, type EmailMeta } from "@/lib/server/chatSend";
import { db } from "@/lib/server/db";
import { readJson, route, str } from "@/lib/server/http";
import { users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { text } — the owner broadcasts a message to every active coach (one encrypted message per coach thread). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER"]);
  const text = str(body.text, "Message", { max: 2000 });
  const d = await db();
  const coaches = await d.select().from(users).where(and(eq(users.role, "COACH"), eq(users.active, true)));
  if (coaches.length === 0) return NextResponse.json({ sent: 0, messages: [] });

  const origin = process.env.APP_URL || new URL(req.url).origin;
  const emails: EmailMeta[] = await Promise.all(coaches.map((c) => notifyByEmail({ from: me, to: c, text, origin, broadcast: true })));
  const stored = await storeMessages(
    coaches.map((c, i) => ({ thread: `o:${c.id}`, text, email: emails[i] })),
    me,
    true,
  );
  return NextResponse.json({ sent: coaches.length, messages: stored });
});
