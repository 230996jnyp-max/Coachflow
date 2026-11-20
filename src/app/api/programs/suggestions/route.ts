import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — this coach's pending Monday suggestions. POST — look at last week now (otherwise the Monday job does it). */
export const GET = route(async () => {
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json({ suggestions: await P.listSuggestions(me) });
});

export const POST = route(async () => {
  const me = await requireUser(["OWNER", "COACH"]);
  const made = await P.generateSuggestions(me.id);
  return NextResponse.json({ made, suggestions: await P.listSuggestions(me) });
});
