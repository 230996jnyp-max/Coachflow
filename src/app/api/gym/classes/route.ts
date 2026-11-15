import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { createClassFor } from "@/lib/server/gymCover";
import { requirePerm } from "@/lib/server/gymOrg";
import { readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { coachId, title, start, capacity, durationMin?, repeatWeeks?, location, notes? } — the gym creates a class and gives it to a coach. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "schedule.manage");
  return NextResponse.json({ ok: true, ...(await createClassFor(m, me, body)) });
});
