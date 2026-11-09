import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { addEntry, loadBundle } from "@/lib/server/nutrition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?from=yyyy-MM-dd&to=yyyy-MM-dd[&clientId=] - the food diary for a range of days, with targets, diets and coach comments. A coach may pass their client's id. */
export const GET = route(async (req) => {
  const me = await requireUser();
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await loadBundle(me, q.get("clientId") ?? undefined, q.get("from"), q.get("to")));
});

/** POST { entries: [...] } (or { entry }) - adds foods to the signed-in person's own diary. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  const list = Array.isArray(body.entries) ? body.entries : body.entry ? [body.entry] : [];
  if (list.length === 0) throw badRequest("Nothing to add.");
  if (list.length > 12) throw badRequest("Add up to 12 foods at a time.");
  const saved = [];
  for (const raw of list) saved.push(await addEntry(me, raw));
  return NextResponse.json({ entries: saved });
});
