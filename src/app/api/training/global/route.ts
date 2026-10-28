import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { allGlobal, nichesOf } from "@/lib/server/niche";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — every shared niche drill, for browsing niches outside the coach's own. */
export const GET = route(async () => {
  const me = await requireUser();
  const scope = await nichesOf(me);
  return NextResponse.json({ exercises: await allGlobal(scope?.hidden ?? []) });
});
