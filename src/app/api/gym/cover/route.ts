import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { cancelAndNotify, coverSession, type CoverKind } from "@/lib/server/gymCover";
import { requirePerm } from "@/lib/server/gymOrg";
import { badRequest, readJson, route, str } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { action: "cover" | "cancel", kind: "session" | "class", id, toCoachId?, reason? }
 * cover: give that session or class to another coach of the gym (choosing the original coach again undoes it).
 * cancel: the coach can't make it, so cancel and tell everyone.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "schedule.manage");
  const kind = body.kind === "class" ? "class" : body.kind === "session" ? "session" : null;
  if (!kind) throw badRequest("Say whether this is a session or a class.");
  const id = str(body.id, "Session", { max: 80 });
  if (body.action === "cover") {
    await coverSession(m, me, kind as CoverKind, id, str(body.toCoachId, "Cover coach", { max: 80 }));
    return NextResponse.json({ ok: true });
  }
  if (body.action === "cancel") {
    await cancelAndNotify(m, me, kind as CoverKind, id, body.reason);
    return NextResponse.json({ ok: true });
  }
  throw badRequest("Unknown action.");
});
