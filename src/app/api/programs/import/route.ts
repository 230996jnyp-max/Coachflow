import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { text } — read a program written as text. Nothing is saved; the draft comes back with any exercise names that were not found. */
export const POST = route(async (req) => {
  const body = await readJson(req, 80_000);
  const me = await requireUser();
  return NextResponse.json(await P.importFromText(me, body.text));
});
