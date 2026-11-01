import { after, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { announceWorkout } from "@/lib/server/clientActivity";
import { alertOnPain } from "@/lib/server/feedback";
import { patchWorkoutSet, putWorkout, removeWorkout, savedState } from "@/lib/server/training";

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
  const before = await savedState(id);
  const saved = await putWorkout(me, w);
  await alertOnPain(me, saved, before?.pain);
  // A client's workout turning "done" for the first time tells their coach (never for one the coach logged, never twice).
  if (me.role === "CLIENT" && saved.status === "DONE" && before?.status !== "DONE") {
    const origin = process.env.APP_URL || new URL(req.url).origin;
    after(() => announceWorkout(me, saved, origin)); // after the response, so saving stays quick
  }
  return NextResponse.json({ ok: true });
});

/** PATCH { entryId, setId, change } - the coach changes values of one set on the live group grid (merged with the client's own edits). */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  if (typeof body.entryId !== "string" || typeof body.setId !== "string") throw badRequest("Missing set.");
  const workout = await patchWorkoutSet(me, id, body.entryId, body.setId, body.change);
  return NextResponse.json({ workout });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await removeWorkout(me, id);
  return NextResponse.json({ ok: true });
});
