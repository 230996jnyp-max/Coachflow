import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/server/ai";
import { requireTrainerOrPersonal } from "@/lib/server/auth";
import { isMinorRow } from "@/lib/server/accounts";
import { HttpError, readJson, route, str } from "@/lib/server/http";
import { ensureNicheRoutines } from "@/lib/server/niche";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { niche } — gives the coach the 3-5 starter routines for a niche (once per niche). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireTrainerOrPersonal();
  const niche = str(body.niche, "Niche", { min: 2, max: 60 });
  if (/[<>{}]/.test(niche)) throw new HttpError(400, "Please type just the name of a niche.");
  const minor = isMinorRow(me);
  if (!minor && !aiConfigured() && !niche.toLowerCase().startsWith("strength")) throw new HttpError(503, "AI isn't set up.");
  // Under 18: only routines that already exist are copied; nothing is generated with AI on their behalf.
  return NextResponse.json(await ensureNicheRoutines(me, niche, { allowAi: !minor }));
});
