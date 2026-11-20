import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET — your programs, the six starters, and whether the AI builder is on. */
export const GET = route(async () => {
  const me = await requireUser();
  P.requireBuilder(me);
  return NextResponse.json({ programs: await P.listPrograms(me), starters: P.listStarters(), aiAvailable: P.programAiAvailable() });
});

/** POST { name, weeks, description?, goal?, level?, slots?, source? } — a new program (blank when there are no slots). */
export const POST = route(async (req) => {
  const body = await readJson(req, 400_000);
  const me = await requireUser();
  return NextResponse.json({ program: await P.createProgram(me, body) });
});
