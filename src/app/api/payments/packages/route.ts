import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { savePackage } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { name, sessions, groupCredits, price } — a coach adds a package to sell. */
export const POST = route(async (req) => {
  const body = await readJson(req, 4_000);
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json({ package: await savePackage(me, body) });
});
