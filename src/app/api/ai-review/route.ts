import { NextResponse } from "next/server";
import { reviewView, startReview, submitReview } from "@/lib/server/aiReview";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — this month's AI review for the signed-in coach: its status, the five profiles while it is open, and what it earns. */
export const GET = route(async () => {
  const me = await requireUser(["COACH", "OWNER"]);
  return NextResponse.json({ review: await reviewView(me) });
});

/** POST { action: "start" } opens the review (fixes the five profiles and starts the clock). POST { action: "submit", answers } sends it. */
export const POST = route(async (req) => {
  const body = await readJson(req, 80_000);
  const me = await requireUser(["COACH", "OWNER"]);
  if (body.action === "start") return NextResponse.json({ review: await startReview(me) });
  if (body.action === "submit") return NextResponse.json({ review: await submitReview(me, body.answers) });
  throw badRequest("Unknown action.");
});
