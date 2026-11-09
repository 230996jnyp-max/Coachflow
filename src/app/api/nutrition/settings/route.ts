import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { setSettings } from "@/lib/server/nutrition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT { adult?, diets?, allergies?, other? } - the signed-in person's own answers (their coach sees them too). */
export const PUT = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  return NextResponse.json({ settings: await setSettings(me, body) });
});
