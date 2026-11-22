import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { setPayNow } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { paynow } — the PayNow number or UEN shown to clients who pay directly (empty to remove it). */
export const PATCH = route(async (req) => {
  const body = await readJson(req, 2_000);
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json({ state: await setPayNow(me, body.paynow ?? "") });
});
