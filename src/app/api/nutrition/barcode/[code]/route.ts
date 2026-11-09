import { NextResponse } from "next/server";
import { takeAiQuota } from "@/lib/server/aiQuota";
import { requireUser } from "@/lib/server/auth";
import { requireAdult } from "@/lib/server/minors";
import { route } from "@/lib/server/http";
import { offBarcode } from "@/lib/server/openFoodFacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

/** GET - one packaged food by barcode number, or { food: null } when the database doesn't have it. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  requireAdult(me); // calorie tracking is off for under-18s
  const { code } = await ctx.params;
  await takeAiQuota(me.id, "barcode", 200, "barcode lookups");
  return NextResponse.json({ food: await offBarcode(code) });
});
