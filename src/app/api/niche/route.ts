import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { nicheStatus, nichesOf } from "@/lib/server/niche";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — how full the library is for each niche the coach works in. */
export const GET = route(async () => {
  const me = await requireUser();
  const scope = await nichesOf(me);
  return NextResponse.json({ status: scope ? await nicheStatus(scope.niches) : [] });
});
