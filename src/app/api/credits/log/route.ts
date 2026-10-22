import { NextResponse } from "next/server";
import { loadClientFor } from "@/lib/server/accounts";
import { requireUser } from "@/lib/server/auth";
import { attendanceStats, loadCreditLog } from "@/lib/server/credits";
import { notFound, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?clientId= — attendance rate and the credit log: a client's own, or (coach) one of their clients'. */
export const GET = route(async (req) => {
  const me = await requireUser();
  const asked = new URL(req.url).searchParams.get("clientId");
  let clientId = me.id;
  if (me.role !== "CLIENT") {
    if (!asked) throw notFound("Choose a client.");
    const row = await loadClientFor(me, asked);
    if (!row) throw notFound("Client not found.");
    clientId = row.id;
  }
  return NextResponse.json({ stats: await attendanceStats(clientId), log: await loadCreditLog(clientId) });
});
