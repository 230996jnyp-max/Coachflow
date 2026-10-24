import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/server/auth";
import { decryptJson } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { badRequest, int, readJson, route, str } from "@/lib/server/http";
import { GROUP_MAX, insertGroup, loadGroups, newSeriesId, shareBooking, whenText } from "@/lib/server/groups";
import { hasConflict, parsePlace, requestLoc, rulesFor, travelCheck } from "@/lib/server/schedule";
import { gyms, templates } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — classes, join requests and notifications visible to the signed-in user. */
export const GET = route(async () => {
  const me = await requireUser();
  return NextResponse.json(await loadGroups(me));
});

/**
 * POST — a coach schedules a group class (optionally repeating weekly), or a client opens one of their own sessions to
 * partners ({ shareBookingId, capacity }).
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();

  if (me.role === "CLIENT") {
    const bookingId = str(body.shareBookingId, "Session", { max: 80 });
    await shareBooking(me, bookingId, int(body.capacity ?? 4, "Group size", 2, 8));
    return NextResponse.json(await loadGroups(me));
  }

  const rules = await rulesFor(me.id);
  const title = str(body.title, "Class title", { max: 100 });
  const capacity = int(body.capacity, "Spots", 2, GROUP_MAX);
  const duration = int(body.durationMin ?? rules.sessionMinutes, "Length", 15, 300);
  const weeks = int(body.repeatWeeks ?? 1, "Weeks", 1, 26);
  const first = new Date(str(body.start, "Start time", { max: 40 }));
  if (Number.isNaN(first.getTime())) throw badRequest("Invalid start time.");
  if (first.getTime() < Date.now() - 5 * 60000) throw badRequest("That start time has already passed.");

  const d = await db();
  const gymId = typeof body.gymId === "string" && body.gymId ? body.gymId.slice(0, 80) : null;
  const place = gymId ? undefined : parsePlace(body.place);
  const customGym = str(body.customGym, "Location", { optional: true, max: 140 }) || place?.name || "";
  if (!gymId && !customGym) throw badRequest("Please choose where the class is held.");
  if (gymId) {
    const [g] = await d.select().from(gyms).where(and(eq(gyms.id, gymId), eq(gyms.coachId, me.id))).limit(1);
    if (!g) throw badRequest("Unknown gym.");
  }
  let templateId: string | undefined;
  let templateName: string | undefined;
  if (typeof body.templateId === "string" && body.templateId) {
    const [t] = await d.select().from(templates).where(and(eq(templates.id, body.templateId), eq(templates.ownerId, me.id))).limit(1);
    if (!t) throw badRequest("That routine wasn't found.");
    templateId = t.id;
    templateName = decryptJson<{ name: string }>(t.dataEnc, `template:${t.id}`).name;
  }
  const notes = str(body.notes, "Notes", { optional: true, max: 500 });
  const waive = body.waiveTravel === true;

  const seriesId = weeks > 1 ? newSeriesId() : undefined;
  const created: string[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = new Date(first.getTime() + i * 7 * 86400000);
    const end = new Date(start.getTime() + duration * 60000);
    if (await hasConflict(me.id, start, end)) {
      skipped.push(`${await whenText(me.id, start)} — overlaps another session`);
      continue;
    }
    if (!waive) {
      const travel = await travelCheck(me.id, start, end, requestLoc({ gymId, customGym, place }), rules, undefined, true);
      if (travel) {
        skipped.push(`${await whenText(me.id, start)} — ${travel}`);
        continue;
      }
    }
    const row = await insertGroup({ coachId: me.id, kind: "CLASS", start, end, capacity, seriesId, details: { title, notes, gymId, customGym: customGym || undefined, place, templateId, templateName } });
    created.push(row.id);
  }
  if (!created.length) throw badRequest(skipped.length ? `Couldn't create the class: ${skipped[0]}` : "Couldn't create the class.");
  return NextResponse.json({ ...(await loadGroups(me)), created, skipped });
});
