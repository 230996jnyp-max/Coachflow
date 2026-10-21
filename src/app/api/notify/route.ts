import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { loadClientFor } from "@/lib/server/accounts";
import { requireUser } from "@/lib/server/auth";
import { contactEmail, displayName } from "@/lib/server/chat";
import { db } from "@/lib/server/db";
import { badRequest, notFound, readJson, route } from "@/lib/server/http";
import { escapeHtml, layout, sendMail, smtpConfigured } from "@/lib/server/mail";
import { users } from "@/lib/server/schema";
import { buildIcs } from "@/lib/ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET — is email delivery configured, and which address are *your* notifications sent to? */
export const GET = route(async () => {
  const me = await requireUser();
  return NextResponse.json({ smtp: smtpConfigured(), to: contactEmail(me) });
});

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

/**
 * POST — { kind: "test" } emails you; { kind: "invite", method, clientId, recipient, event } emails a calendar invite for a
 * session between a coach and one of their clients to the coach or the client (looked up on the server, never supplied
 * by the browser). Only that coach or that client may send it.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  const origin = process.env.APP_URL || new URL(req.url).origin;

  if (body.kind === "test") {
    const to = contactEmail(me);
    if (!to) throw badRequest("Your account has no email address on file.");
    const result = await sendMail({
      to,
      subject: "[CoachFlow] Test notification",
      text: `Hi ${displayName(me)},\n\nThis is a test notification from CoachFlow. Email delivery is working.\n${origin}`,
      html: layout("Test notification", `<p style="margin:0;color:#E8ECF4;">Email delivery from CoachFlow is working. You will get messages and calendar invites here.</p>`, { label: "Open CoachFlow", href: origin }),
    });
    return NextResponse.json({ result, smtp: smtpConfigured() });
  }

  if (body.kind !== "invite" || typeof body.event !== "object" || !body.event) throw badRequest("Unknown notification kind.");
  const clientId = clip(body.clientId, 80);
  const client = await loadClientFor(me, clientId);
  if (!client) throw notFound("Client not found.");
  const d = await db();
  const [coach] = client.coachId ? await d.select().from(users).where(eq(users.id, client.coachId)).limit(1) : [];
  const target = body.recipient === "CLIENT" ? client : coach;
  if (!target) throw notFound("Recipient not found.");
  const to = contactEmail(target);
  if (!to) return NextResponse.json({ result: { status: "failed", error: "The recipient has no email address on file." }, smtp: smtpConfigured() });

  const e = body.event as Record<string, unknown>;
  const start = new Date(clip(e.start, 40));
  const end = new Date(clip(e.end, 40));
  const uid = clip(e.uid, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw badRequest("Invalid event.");
  const method = body.method === "CANCEL" ? "CANCEL" : "REQUEST";
  const summary = clip(e.summary, 120) || "PT session";
  const location = clip(e.location, 200);
  const description = clip(e.description, 600);
  const from = process.env.SMTP_USER || "no-reply@coachflow.local";
  const toName = displayName(target);
  const ics = buildIcs([{ uid, start, end, summary, location, description, rev: Math.max(0, Math.min(999, Number(e.rev) || 0)), cancelled: method === "CANCEL" }], {
    method,
    calName: "CoachFlow sessions",
    organizer: { name: "CoachFlow", email: from },
    attendee: { name: toName, email: to },
  });
  const when = start.toLocaleString("en-SG", { dateStyle: "full", timeStyle: "short", timeZone: process.env.APP_TZ || "Asia/Singapore" });
  const cancelled = method === "CANCEL";
  const result = await sendMail({
    to,
    subject: `${cancelled ? "Cancelled" : "Session"}: ${summary} — ${when}`,
    text: `${cancelled ? "This session was cancelled" : "You have a session booked"}.\n\n${summary}\n${when}\n${location}\n${description}\n\nOpen the attached invite to add it to your calendar.`,
    html: layout(
      cancelled ? "Session cancelled" : "Session booked",
      `<p style="margin:0 0 8px;font-weight:600;color:#fff;">${escapeHtml(summary)}</p>
       <p style="margin:0 0 4px;color:#E8ECF4;">${escapeHtml(when)}</p>
       <p style="margin:0 0 12px;color:#8892A6;">${escapeHtml(location)}</p>
       <p style="margin:0;color:#8892A6;font-size:13px;">${cancelled ? "Your calendar should remove this event automatically." : "Accept the attached invite to add it to your calendar. You will get a reminder 24 hours and 1 hour before."}</p>`,
      { label: "Open CoachFlow", href: `${origin}/book` },
    ),
    ics: { method, content: ics },
  });
  return NextResponse.json({ result, smtp: smtpConfigured() });
});
