import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { addBranch, deleteBranch, gymSettings, membershipOf, requirePerm, updateBranch } from "@/lib/server/gymOrg";
import { readJson, route, str } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function reply(userId: string) {
  const m = await membershipOf(userId);
  return NextResponse.json({ ok: true, branches: m ? (await gymSettings(m.gym)).branches : [] });
}

/** POST { name, address? } — add a branch or hall. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "branding.manage");
  await addBranch(m, me, body.name, body.address);
  return reply(me.id);
});

/** PATCH { id, name?, address? } */
export const PATCH = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "branding.manage");
  await updateBranch(m, me, str(body.id, "Branch", { max: 80 }), body);
  return reply(me.id);
});

/** DELETE { id } */
export const DELETE = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "branding.manage");
  await deleteBranch(m, me, str(body.id, "Branch", { max: 80 }));
  return reply(me.id);
});
