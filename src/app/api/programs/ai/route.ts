import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** POST { goal, weeks, daysPerWeek, sessionMinutes, level, equipment, focus, injuries, clientId?, progression?, name? } — the AI builder. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  return NextResponse.json(await P.buildWithAi(me, body));
});
