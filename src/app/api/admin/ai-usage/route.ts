import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { aiUsageReport } from "@/lib/server/gymAdmin";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET [?gymId=] — owner only: AI use per coach (today, 7 days, 30 days, all time), by feature, with their gym; and per gym. */
export const GET = route(async (req) => {
  await requireUser(["OWNER"]);
  const gymId = new URL(req.url).searchParams.get("gymId") || undefined;
  return NextResponse.json(await aiUsageReport({ gymId }));
});
