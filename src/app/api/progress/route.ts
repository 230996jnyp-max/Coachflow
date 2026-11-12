import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { loadBody } from "@/lib/server/bodyData";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?since=<ISO> — body check-ins and progress-photo details for the signed-in person (a coach also gets their own clients'). Only what
 * changed since `since`, plus every visible id so the browser can drop anything deleted elsewhere. Pictures are fetched separately.
 */
export const GET = route(async (req) => {
  const me = await requireUser();
  const raw = new URL(req.url).searchParams.get("since");
  const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : undefined;
  return NextResponse.json(await loadBody(me, since));
});
