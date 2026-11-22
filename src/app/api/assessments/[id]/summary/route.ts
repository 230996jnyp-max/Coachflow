import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { aiSummary } from "@/lib/server/assessments";
import { assertSameOrigin, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST — an optional plain-English paragraph (AI) from the findings, for the coach. Adults only; no names are sent. Null when AI is off. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json({ text: await aiSummary(me, id) });
});
