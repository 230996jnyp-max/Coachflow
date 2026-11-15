import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { requirePerm } from "@/lib/server/gymOrg";
import { masterSchedule } from "@/lib/server/gymSchedule";
import { badRequest, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?from=ISO&to=ISO&coachId=&branchId= — the master schedule: every coach's sessions and classes, up to two months at a time. */
export const GET = route(async (req) => {
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "schedule.view");
  const u = new URL(req.url);
  const from = new Date(u.searchParams.get("from") ?? "");
  const to = new Date(u.searchParams.get("to") ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw badRequest("Choose a start and an end date.");
  if (to.getTime() - from.getTime() > 62 * 86_400_000) throw badRequest("Choose a range of two months or less.");
  const coachId = u.searchParams.get("coachId") || undefined;
  const branchId = u.searchParams.get("branchId") || undefined;
  return NextResponse.json(await masterSchedule(m, { from, to, coachId, branchId }));
});
