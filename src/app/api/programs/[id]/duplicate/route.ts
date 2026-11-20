import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
export const POST = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json({ program: await P.duplicateProgram(me, id) });
});
