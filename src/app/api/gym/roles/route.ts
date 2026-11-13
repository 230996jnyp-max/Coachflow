import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { createRole, deleteRole, listRoles, requirePerm, requirePortal, updateRole } from "@/lib/server/gymOrg";
import { readJson, route, str } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePortal(me);
  return NextResponse.json({ roles: await listRoles(m.gym.id) });
});

/** POST { name, perms } — make a role with exactly the permissions you choose. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "roles.manage");
  const id = await createRole(m, me, body.name, body.perms);
  return NextResponse.json({ ok: true, id, roles: await listRoles(m.gym.id) });
});

/** PATCH { id, name?, perms? } */
export const PATCH = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "roles.manage");
  await updateRole(m, me, str(body.id, "Role", { max: 80 }), body);
  return NextResponse.json({ ok: true, roles: await listRoles(m.gym.id) });
});

/** DELETE { id } */
export const DELETE = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "roles.manage");
  await deleteRole(m, me, str(body.id, "Role", { max: 80 }));
  return NextResponse.json({ ok: true, roles: await listRoles(m.gym.id) });
});
