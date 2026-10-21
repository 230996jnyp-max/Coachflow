import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { badRequest, int, readJson, route, str } from "@/lib/server/http";
import { slots } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** POST — add an availability window: RECURRING (weekday), ONE_OFF (date) or BLOCK (date). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const kind = body.kind;
  if (kind !== "RECURRING" && kind !== "ONE_OFF" && kind !== "BLOCK") throw badRequest("Unknown slot type.");
  const start = str(body.start, "Start time", { max: 5 });
  const end = str(body.end, "End time", { max: 5 });
  if (!TIME.test(start) || !TIME.test(end) || start >= end) throw badRequest("End time must be after the start time.");

  let weekday: number | null = null;
  let date: string | null = null;
  if (kind === "RECURRING") weekday = int(body.weekday, "Weekday", 0, 6);
  else {
    date = str(body.date, "Date", { max: 10 });
    if (!DATE.test(date)) throw badRequest("Date must look like 2026-10-31.");
  }
  const label = kind === "BLOCK" ? str(body.label, "Label", { optional: true, max: 80 }) || null : null;
  const id = `a_${randomUUID()}`;
  const d = await db();
  await d.insert(slots).values({ id, coachId: me.id, kind, weekday, date, startTime: start, endTime: end, label });
  return NextResponse.json({ slot: { id, kind, weekday: weekday ?? undefined, date: date ?? undefined, start, end, label: label ?? undefined } });
});
