import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import * as A from "@/lib/server/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?status=DRAFT,HELD&clientId= — drafts, held messages and the activity log. */
export const GET = route(async (req) => {
  const me = await requireUser(["OWNER", "COACH"]);
  const u = new URL(req.url);
  const status = u.searchParams.get("status")?.split(",").filter(Boolean);
  const clientId = u.searchParams.get("clientId") ?? undefined;
  return NextResponse.json({ events: await A.listEvents(me, { status, clientId, limit: 100 }) });
});
