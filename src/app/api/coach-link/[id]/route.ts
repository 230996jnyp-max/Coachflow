import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { decide, pendingFor } from "@/lib/server/coachLinks";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { decision: "accept" | "decline" } — a coach answers a request. Accepting makes the person that coach's client. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const body = await readJson(req, 500);
  const me = await requireUser(["OWNER", "COACH"]);
  if (body.decision !== "accept" && body.decision !== "decline") throw badRequest("Choose accept or decline.");
  const { id } = await ctx.params;
  await decide(me, id, body.decision === "accept");
  return NextResponse.json({ requests: await pendingFor(me) });
});
