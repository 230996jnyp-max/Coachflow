import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { createAssignments, loadAssignments } from "@/lib/server/assignments";
import { readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the workouts assigned to the signed-in client, or (for a coach) to their clients: about the last 100 days and the next 200. */
export const GET = route(async () => {
  const me = await requireUser();
  return NextResponse.json({ assignments: await loadAssignments(me) });
});

/** POST { clientId, templateId, date, note?, title?, repeatWeeks? } — a coach assigns one of their routines to a client on a day (and weekly after, up to 12 more weeks). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const result = await createAssignments(me, body);
  return NextResponse.json({ ...result, assignments: await loadAssignments(me) });
});
