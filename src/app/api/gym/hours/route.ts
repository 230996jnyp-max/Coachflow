import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { requirePerm } from "@/lib/server/gymOrg";
import { hoursCsv, hoursReport } from "@/lib/server/gymSchedule";
import { badRequest, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv] — completed hours per coach for a month or any range (the end date is included). */
export const GET = route(async (req) => {
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "hours.view");
  const u = new URL(req.url);
  const f = u.searchParams.get("from") ?? "";
  const t = u.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw badRequest("Choose a start and an end date.");
  // Dates are the gym's local days (Singapore time, UTC+8), end date included.
  const from = new Date(`${f}T00:00:00+08:00`);
  const to = new Date(new Date(`${t}T00:00:00+08:00`).getTime() + 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw badRequest("The end date can't be before the start date.");
  if (to.getTime() - from.getTime() > 400 * 86_400_000) throw badRequest("Choose a range of a year or less.");
  const report = await hoursReport(m.gym, { from, to });
  if (u.searchParams.get("format") === "csv") {
    return new Response(hoursCsv(report, f, t), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="coach-hours-${f}-to-${t}.csv"` } });
  }
  return NextResponse.json(report);
});
