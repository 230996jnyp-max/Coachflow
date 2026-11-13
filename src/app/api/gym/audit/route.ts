import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { recentAudit, requirePerm } from "@/lib/server/gymOrg";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — who linked, removed, moved or covered whom (newest first). */
export const GET = route(async () => {
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "activity.view");
  return NextResponse.json({ items: await recentAudit(m.gym.id, 100) });
});
