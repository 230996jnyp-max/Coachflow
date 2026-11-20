import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import * as A from "@/lib/server/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — add the suggested rules for every trigger you have not set up, all switched off. */
export const POST = route(async () => {
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json({ rules: await A.applyStarterPack(me) });
});
