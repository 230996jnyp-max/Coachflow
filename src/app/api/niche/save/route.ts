import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { HttpError, readJson, route, str } from "@/lib/server/http";
import { saveReviewed } from "@/lib/server/niche";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { niche, exercises } — the drills a coach reviewed for a new niche go into the shared library. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  await requireUser(["OWNER", "COACH"]);
  const niche = str(body.niche, "Niche", { min: 2, max: 60 });
  if (/[<>{}]/.test(niche)) throw new HttpError(400, "Please type just the name of a niche.");
  return NextResponse.json(await saveReviewed(niche, body.exercises));
});
