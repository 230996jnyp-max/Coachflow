import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { deleteTracking, putTracking } from "@/lib/server/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT { tracking } - a coach sets their own tracking format (set columns + chart metric) for an exercise; their clients get it too. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  return NextResponse.json({ tracking: await putTracking(me, id, body.tracking) });
});

/** DELETE - back to the exercise's default tracking format. */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  await deleteTracking(me, id);
  return NextResponse.json({ ok: true });
});
