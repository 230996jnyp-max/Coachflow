import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
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
  };
  const d = await db();
  await d
    .insert(coachSettings)
    .values({ coachId: me.id, ...next })
    .onConflictDoUpdate({ target: coachSettings.coachId, set: next });
  return NextResponse.json({ settings: next });
});
