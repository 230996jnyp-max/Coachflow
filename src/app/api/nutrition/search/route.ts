import { NextResponse } from "next/server";
import { takeAiQuota } from "@/lib/server/aiQuota";
import { requireUser } from "@/lib/server/auth";
import { requireAdult } from "@/lib/server/minors";
import { route } from "@/lib/server/http";
import { offSearch } from "@/lib/server/openFoodFacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?q=words - packaged foods from Open Food Facts (the built-in everyday foods are searched in the browser). */
export const GET = route(async (req) => {
  const me = await requireUser();
  requireAdult(me); // calorie tracking is off for under-18s
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ packaged: [] });
  await takeAiQuota(me.id, "foodsearch", 300, "packaged-food searches");
  try {
    return NextResponse.json({ packaged: await offSearch(q) });
  } catch (e) {
    // The built-in list still works when the database is slow or down.
    return NextResponse.json({ packaged: [], unavailable: e instanceof Error ? e.message : "unavailable" });
  }
});
