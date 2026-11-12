import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { copyAssignment, deleteAssignment, loadAssignments, updateAssignment } from "@/lib/server/assignments";
import { readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { date?, note?, doneManually? } — move it, change its note, or tick it off by hand. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  await updateAssignment(me, id, body);
  return NextResponse.json({ assignments: await loadAssignments(me) });
});

/** POST { dates: string[] } — copy it onto other days. */
export const POST = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  const result = await copyAssignment(me, id, body.dates);
  return NextResponse.json({ ...result, assignments: await loadAssignments(me) });
});

/** DELETE ?scope=future — delete it, or it and every later one from the same "repeat weekly". */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  const scope = new URL(req.url).searchParams.get("scope") === "future" ? "future" : "one";
  const deleted = await deleteAssignment(me, id, scope);
  return NextResponse.json({ deleted, assignments: await loadAssignments(me) });
});
