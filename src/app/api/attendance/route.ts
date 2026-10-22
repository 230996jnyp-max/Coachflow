import { NextResponse } from "next/server";
import { applyAttendance, type MarkInput } from "@/lib/server/attendance";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route, str } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { kind: "BOOKING" | "GROUP", id, marks?: [{ clientId, mark: "PRESENT" | "NO_SHOW" | "CLEAR", deduct? }], finalize?, reopen? }
 * Coach only. Marks people present / no-show (settling credits), finalises the session, or re-opens it.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const kind = body.kind === "GROUP" ? "GROUP" : body.kind === "BOOKING" ? "BOOKING" : null;
  if (!kind) throw badRequest("Unknown session type.");
  const marks: MarkInput[] = (Array.isArray(body.marks) ? body.marks : []).slice(0, 60).map((m: unknown) => {
    const r = (m ?? {}) as Record<string, unknown>;
    return { clientId: str(r.clientId, "Client", { max: 80 }), mark: r.mark as MarkInput["mark"], deduct: r.deduct === true };
  });
  await applyAttendance(me, { kind, id: str(body.id, "Session", { max: 80 }), marks, finalize: body.finalize === true, reopen: body.reopen === true });
  return NextResponse.json({ ok: true });
});
