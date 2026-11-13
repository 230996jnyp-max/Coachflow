import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { exportCsv } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — every payment as a CSV file for the coach's own records. */
export const GET = route(async () => {
  const me = await requireUser(["OWNER", "COACH"]);
  return new Response(await exportCsv(me), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="coachflow-payments.csv"', "Cache-Control": "private, no-store" } });
});
