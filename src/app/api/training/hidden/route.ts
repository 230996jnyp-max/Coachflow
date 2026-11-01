import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { setHidden } from "@/lib/server/niche";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT { id, hide } — a coach hides (or restores) a shared-library drill for themselves and their clients. */
export const PUT = route(async (req) => {
  const me = await requireUser(["OWNER", "COACH"]);
  const body = await readJson(req);
  if (typeof body.id !== "string" || !/^gx_[A-Za-z0-9_]{1,76}$/.test(body.id)) throw badRequest("That isn't a shared exercise.");
  return NextResponse.json({ hidden: await setHidden(me, body.id, body.hide !== false) });
});
