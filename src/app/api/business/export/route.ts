import { requireUser } from "@/lib/server/auth";
import { classesCsv, performanceCsv } from "@/lib/business";
import { coachBusiness, gymBusiness } from "@/lib/server/business";
import { badRequest, forbidden, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?view=coach|gym&report=performance|classes — a spreadsheet of the same numbers the Business page shows. A gym's file needs the same
 * permission as the page (coach performance follows hours and payroll). Counts only: no client names or details.
 */
export const GET = route(async (req) => {
  const me = await requireUser(["OWNER", "COACH"], { skipBilling: true });
  const q = new URL(req.url).searchParams;
  const view = q.get("view");
  const report = q.get("report");
  if ((view !== "coach" && view !== "gym") || (report !== "performance" && report !== "classes")) throw badRequest("Choose a view (coach or gym) and a report (performance or classes).");

  let body: string;
  if (view === "gym") {
    const g = await gymBusiness(me);
    if (report === "performance") {
      if (!g.performance) throw forbidden("Your gym role doesn't include coach performance.");
      body = performanceCsv(g.performance);
    } else body = classesCsv(g.occupancy.byClass);
  } else {
    const c = await coachBusiness(me);
    body = report === "performance" ? performanceCsv([c.performance]) : classesCsv(c.occupancy?.byClass ?? []);
  }
  const day = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${body}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="coachflow-${view}-${report}-${day}.csv"`, "Cache-Control": "private, no-store" } });
});
