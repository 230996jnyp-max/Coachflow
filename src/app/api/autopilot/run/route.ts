import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as A from "@/lib/server/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST — look for new events now. POST { tick: true } — the same, but only if it has been 10 minutes (the dashboard does this). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const origin = new URL(req.url).origin;
  const result = body.tick === true ? await A.tick(me, origin) : await A.runNow(me, origin);
  return NextResponse.json({ ran: result !== null, result });
});
