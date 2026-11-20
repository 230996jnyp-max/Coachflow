import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, readJson, route } from "@/lib/server/http";
import { setCustomPrice } from "@/lib/server/gymPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT { priceDollars: number | null } — the platform owner sets (or clears) a large gym's custom monthly price, in S$. */
export const PUT = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  await requireUser(["OWNER"]);
  const { id } = await ctx.params;
  const body = await readJson(req);
  const cents = await setCustomPrice(id, body.priceDollars);
  return NextResponse.json({ priceCents: cents });
});
