import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as A from "@/lib/server/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ trigger: string }> };
/** PUT { enabled?, mode?, actions? } — change one rule. Rules start switched off. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { trigger } = await ctx.params;
  return NextResponse.json({ rules: await A.saveRule(me, trigger, body) });
});
