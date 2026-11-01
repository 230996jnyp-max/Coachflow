import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { CORE_SPORTS, cleanSports } from "@/lib/sports";
import { int, readJson, route } from "@/lib/server/http";
import { DEFAULT_RULES, rulesFor } from "@/lib/server/schedule";
import { coachSettings } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT — a coach updates their booking rules (partial updates allowed). */
export const PUT = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const cur = await rulesFor(me.id);
  const next = {
    sessionMinutes: "sessionMinutes" in body ? int(body.sessionMinutes, "Session length", 15, 240) : cur.sessionMinutes,
    noticeHours: "noticeHours" in body ? int(body.noticeHours, "Notice hours", 0, 336) : cur.noticeHours,
    autoConfirm: typeof body.autoConfirm === "boolean" ? body.autoConfirm : cur.autoConfirm,
    allowCustomGym: typeof body.allowCustomGym === "boolean" ? body.allowCustomGym : cur.allowCustomGym,
    utcOffsetMin: "utcOffsetMin" in body ? int(body.utcOffsetMin, "UTC offset", -720, 840) : (cur.utcOffsetMin ?? DEFAULT_RULES.utcOffsetMin),
    travelEnabled: typeof body.travelEnabled === "boolean" ? body.travelEnabled : cur.travelEnabled,
    travelDefaultMin: "travelDefaultMin" in body ? int(body.travelDefaultMin, "Default travel buffer", 0, 240) : cur.travelDefaultMin,
    travelParkingMin: "travelParkingMin" in body ? int(body.travelParkingMin, "Parking buffer", 0, 120) : cur.travelParkingMin,
    travelMaxMin: "travelMaxMin" in body ? int(body.travelMaxMin, "Maximum travel buffer", 0, 240) : cur.travelMaxMin,
    specialties: cur.specialties,
    sports: cur.sports,
  };
  // Sports the coach added (never a copy of a built-in one), then specialties chosen from the built-in and added ones.
  if ("sports" in body) next.sports = cleanSports(body.sports, 20).filter((s) => !(CORE_SPORTS as readonly string[]).some((c) => c.toLowerCase() === s.toLowerCase()));
  if ("specialties" in body) next.specialties = cleanSports(body.specialties, 12);
  next.specialties = next.specialties.filter((s) => (CORE_SPORTS as readonly string[]).includes(s) || next.sports.includes(s));
  const d = await db();
  const stored = { ...next, specialties: JSON.stringify(next.specialties), sports: JSON.stringify(next.sports) };
  await d
    .insert(coachSettings)
    .values({ coachId: me.id, ...stored })
    .onConflictDoUpdate({ target: coachSettings.coachId, set: stored });
  return NextResponse.json({ settings: next });
});
