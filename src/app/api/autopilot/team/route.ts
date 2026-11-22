import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import * as A from "@/lib/server/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — for a gym manager: what the gym's coaches' Autopilot has done (who, what, when; never the messages, never the rules). */
export const GET = route(async () => {
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json(await A.teamLog(me));
});
