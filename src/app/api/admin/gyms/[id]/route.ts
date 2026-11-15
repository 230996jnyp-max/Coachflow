import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { applyGymAction, type GymAction } from "@/lib/server/gymAdmin";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { action: "disable" | "enable" | "delete", reason?, confirmName? } — the owner switches a gym off or on, or deletes it. Its owner is emailed. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER"]);
  const { id } = await ctx.params;
  const action = body.action as GymAction;
  if (action !== "disable" && action !== "enable" && action !== "delete") throw badRequest("Unknown action.");
  const res = await applyGymAction(me, id, action, { reason: typeof body.reason === "string" ? body.reason : "", confirmName: typeof body.confirmName === "string" ? body.confirmName : "" });
  return NextResponse.json({ ok: true, ...res });
});
