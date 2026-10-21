import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { putExercise } from "@/lib/server/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT { exercise } — create or update one of the caller's custom exercises. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  const x = body.exercise as { id?: unknown } | undefined;
  if (!x || x.id !== id) throw badRequest("Exercise does not match the address.");
  await putExercise(me, x);
  return NextResponse.json({ ok: true });
});
