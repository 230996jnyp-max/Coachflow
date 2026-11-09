import { NextResponse } from "next/server";
import type { MarkInput } from "@/lib/server/attendance";
import { requireUser } from "@/lib/server/auth";
import { endFloorSession } from "@/lib/server/floor";
import { badRequest, readJson, route, str } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { kind: "BOOKING" | "GROUP", id, marks: [{ clientId, mark: "PRESENT" | "NO_SHOW", deduct? }], workoutIds: string[] }
 * Coach only. Gym-floor "End session": settles attendance and credits for everyone, finalises the session and sends recaps.
 * Safe to repeat (a retry after a lost connection does the same thing, and nobody is told twice).
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const kind = body.kind === "GROUP" ? "GROUP" : body.kind === "BOOKING" ? "BOOKING" : null;
  if (!kind) throw badRequest("Unknown session type.");
  const marks: MarkInput[] = (Array.isArray(body.marks) ? body.marks : []).slice(0, 60).map((m: unknown) => {
    const r = (m ?? {}) as Record<string, unknown>;
    if (r.mark !== "PRESENT" && r.mark !== "NO_SHOW") throw badRequest("Choose Present or No-Show for everyone.");
    return { clientId: str(r.clientId, "Client", { max: 80 }), mark: r.mark, deduct: r.deduct === true };
  });
  const workoutIds = (Array.isArray(body.workoutIds) ? body.workoutIds : []).filter((x: unknown): x is string => typeof x === "string").slice(0, 40);
  const out = await endFloorSession(me, { kind, id: str(body.id, "Session", { max: 80 }), marks, workoutIds });
  return NextResponse.json({ ok: true, ...out });
});
