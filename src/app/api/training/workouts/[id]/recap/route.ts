import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { emailRecap } from "@/lib/server/recap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** POST — emails this finished workout's recap to the client's email. Allowed for the client themself and their coach. */
export const POST = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const r = await emailRecap(me, id);
  return NextResponse.json({ ok: true, to: r.to });
});
