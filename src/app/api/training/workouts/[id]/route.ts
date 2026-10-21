import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { putWorkout, removeWorkout } from "@/lib/server/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT { workout } — create or replace one workout the caller is allowed to log. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  const w = body.workout as { id?: unknown } | undefined;
  if (!w || w.id !== id) throw badRequest("Workout does not match the address.");
  await putWorkout(me, w);
  return NextResponse.json({ ok: true });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await removeWorkout(me, id);
  return NextResponse.json({ ok: true });
});
