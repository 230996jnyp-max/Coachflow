import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { openProfile } from "@/lib/server/accounts";
import { db } from "@/lib/server/db";
import { buildIcs, type IcsEvent } from "@/lib/ics";
import { toBooking } from "@/lib/server/schedule";
import { bookings, calendarTokens, gyms, users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/**
 * GET /api/calendar/<token>.ics — a coach's private iCalendar feed (RFC 5545). Calendar apps subscribe to it with
 * webcal:// and re-fetch periodically, so new, moved and cancelled sessions flow through. The secret token is the only
 * credential; it shows client names, focus and location, never booking notes.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const token = file.replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return text("Not found", 404);

  const d = await db();
  const hash = createHash("sha256").update(token).digest("hex");
  const [t] = await d.select().from(calendarTokens).where(eq(calendarTokens.tokenHash, hash)).limit(1);
  if (!t) return text("Not found", 404);
  const [coach] = await d.select().from(users).where(eq(users.id, t.userId)).limit(1);
  if (!coach || !coach.active) return text("Not found", 404);

  const since = new Date(Date.now() - 60 * 86400000);
  const rows = await d.select().from(bookings).where(and(eq(bookings.coachId, coach.id), gt(bookings.endAt, since)));
  const gymRows = await d.select().from(gyms).where(eq(gyms.coachId, coach.id));
  const gymName = new Map(gymRows.map((g) => [g.id, g.name]));
  const clientRows = await d.select().from(users).where(eq(users.coachId, coach.id));
  const clientName = new Map<string, string>();
  for (const c of clientRows) {
    try {
      clientName.set(c.id, openProfile(c).name);
    } catch {
      clientName.set(c.id, "Client");
    }
  }

  const events: IcsEvent[] = rows.map((r) => {
    const b = toBooking(r);
    return {
      uid: b.id,
      start: r.startAt,
      end: r.endAt,
      summary: `PT session — ${clientName.get(r.clientId) ?? "Client"}`,
      description: [`Focus: ${b.focus}`, r.status === "PENDING" ? "Awaiting your approval" : "", r.status === "NO_SHOW" ? "No-show" : ""].filter(Boolean).join("\n"),
      location: b.customGym || (b.gymId ? gymName.get(b.gymId) : undefined) || undefined,
      rev: r.rev,
      cancelled: r.status === "CANCELLED" || r.status === "DECLINED",
      tentative: r.status === "PENDING",
    };
  });

  const ics = buildIcs(events, { method: "PUBLISH", calName: `${coach.name ?? "Coach"} — PT sessions`, alarms: [60], refreshMinutes: 15 });
  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="coachflow-sessions.ics"',
      "Cache-Control": "private, no-cache, max-age=0",
    },
  });
}
