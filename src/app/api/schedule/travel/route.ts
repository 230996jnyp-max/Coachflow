import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { coachIdFor, parsePlace, requestLoc, rulesFor, travelNeighbors } from "@/lib/server/schedule";
import { str } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { gymId?, customGym?, place? } — for a location a client (or coach) is considering, returns each of the coach's
 * sessions with the travel buffer it would need and whether it is at the same place. Times only: other people's
 * names and locations never leave the server.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  const coachId = coachIdFor(me);
  if (!coachId) return NextResponse.json({ enabled: false, neighbors: [] });
  const rules = await rulesFor(coachId);
  if (!rules.travelEnabled) return NextResponse.json({ enabled: false, neighbors: [] });
  const gymId = typeof body.gymId === "string" && body.gymId ? body.gymId.slice(0, 80) : null;
  const place = gymId ? undefined : parsePlace(body.place);
  const customGym = str(body.customGym, "Location", { optional: true, max: 140 }) || place?.name || "";
  const neighbors = await travelNeighbors(coachId, requestLoc({ gymId, customGym, place }), rules);
  return NextResponse.json({ enabled: true, neighbors });
});
