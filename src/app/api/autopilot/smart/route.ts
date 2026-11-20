import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as A from "@/lib/server/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET / PUT { enabled?, tone? } — smart replies: off until you switch them on, and the tone. */
export const GET = route(async () => {
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json({ smart: await A.smartSettings(me) });
});
export const PUT = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json({ smart: await A.saveSmartSettings(me, body) });
});
