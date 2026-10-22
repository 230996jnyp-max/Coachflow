import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { loadGroups, markNotificationsRead } from "@/lib/server/groups";
import { readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { ids: string[] | "all" } — marks notifications as read. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  const ids = body.ids === "all" ? "all" : Array.isArray(body.ids) ? (body.ids.filter((x) => typeof x === "string") as string[]) : [];
  await markNotificationsRead(me.id, ids);
  return NextResponse.json(await loadGroups(me));
});
