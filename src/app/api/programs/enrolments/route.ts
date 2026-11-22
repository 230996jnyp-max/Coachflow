import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?clientId= — the programs running now (for a coach: their clients'; for a client: their own). */
export const GET = route(async (req) => {
  const me = await requireUser();
  const clientId = new URL(req.url).searchParams.get("clientId") ?? undefined;
  return NextResponse.json({ enrolments: await P.listEnrolments(me, clientId) });
});
