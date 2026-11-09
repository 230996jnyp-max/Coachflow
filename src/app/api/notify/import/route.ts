import { after, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { announceRoutines } from "@/lib/server/clientActivity";
import { badRequest, int, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { titles, exercises } — a client saved imported routines: their coach is told (not what is in them: those stay private). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["CLIENT"]);
  if (!Array.isArray(body.titles) || body.titles.length === 0 || body.titles.length > 20) throw badRequest("Nothing to report.");
  const titles = body.titles.filter((t: unknown): t is string => typeof t === "string");
  const exercises = int(body.exercises ?? 0, "Exercises", 0, 500);
  const origin = process.env.APP_URL || new URL(req.url).origin;
  after(() => announceRoutines(me, titles, exercises, origin));
  return NextResponse.json({ ok: true });
});
