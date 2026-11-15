import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/server/ai";
import { logAiUsage } from "@/lib/server/aiLog";
import { requireTrainerOrPersonal } from "@/lib/server/auth";
import { requireAdult } from "@/lib/server/minors";
import { HttpError, readJson, route, str } from "@/lib/server/http";
import { seedBatch } from "@/lib/server/niche";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { niche } — builds the next batch of drills for a niche in the shared library (the browser repeats until it is done). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireTrainerOrPersonal();
  requireAdult(me);
  if (!aiConfigured()) throw new HttpError(503, "AI isn't set up.");
  await logAiUsage({ userId: me.id, feature: "niche_search" });
  const niche = str(body.niche, "Niche", { min: 2, max: 60 });
  if (/[<>{}]/.test(niche)) throw new HttpError(400, "Please type just the name of a niche.");
  return NextResponse.json(await seedBatch(niche));
});
