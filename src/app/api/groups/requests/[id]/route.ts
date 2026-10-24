import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { cancelRequest, decideRequest, loadGroups } from "@/lib/server/groups";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { decision: "approve" | "decline" | "cancel" } — the coach or a current attendee answers a join request; the requester can withdraw it. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  if (body.decision === "cancel") await cancelRequest(me, id);
  else if (body.decision === "approve" || body.decision === "decline") await decideRequest(me, id, body.decision === "approve");
  else throw badRequest("Choose approve or decline.");
  return NextResponse.json(await loadGroups(me));
});
