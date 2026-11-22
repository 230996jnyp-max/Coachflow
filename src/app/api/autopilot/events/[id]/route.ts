import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as A from "@/lib/server/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
/** POST { action: "send" | "dismiss", text? } — approve a draft (optionally with your own words) or throw it away. */
export const POST = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  const r = await A.decideEvent(me, id, body, new URL(req.url).origin);
  return NextResponse.json({ ...r, waiting: await A.listEvents(me, { status: ["DRAFT", "HELD"], limit: 100 }) });
});
