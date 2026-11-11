import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { loadGroups, loadNotifications, markNotificationsRead } from "@/lib/server/groups";
import { readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?limit=1..200&before=ISO — the person's notifications, newest first, for the Notifications page (the bell keeps the latest 40). */
export const GET = route(async (req) => {
  const me = await requireUser();
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw ? new Date(beforeRaw) : undefined;
  const list = await loadNotifications(me.id, { limit: Number.isFinite(limit) ? limit : 100, before: before && !Number.isNaN(before.getTime()) ? before : undefined });
  return NextResponse.json({ notifications: list });
});

/** POST { ids: string[] | "all" } — marks notifications as read. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  const ids = body.ids === "all" ? "all" : Array.isArray(body.ids) ? (body.ids.filter((x) => typeof x === "string") as string[]) : [];
  await markNotificationsRead(me.id, ids);
  return NextResponse.json(await loadGroups(me));
});
