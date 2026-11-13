import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { movesForClient, movesForGym, proposeMove } from "@/lib/server/gymCover";
import { membershipOf, requirePerm } from "@/lib/server/gymOrg";
import { readJson, route, str } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — a client: the moves waiting for their answer. A gym person who runs the schedule: the gym's recent moves. */
export const GET = route(async () => {
  const me = await requireUser();
  if (me.role === "CLIENT") return NextResponse.json({ moves: await movesForClient(me) });
  const m = await membershipOf(me.id);
  if (!m || m.member.status !== "ACTIVE" || !m.perms.includes("schedule.manage")) return NextResponse.json({ moves: [] });
  return NextResponse.json({ moves: await movesForGym(m.gym.id) });
});

/** POST { clientId, toCoachId } — ask a client to move to another coach of the gym. Nothing changes until they agree. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "schedule.manage");
  const id = await proposeMove(m, me, str(body.clientId, "Client", { max: 80 }), str(body.toCoachId, "Coach", { max: 80 }));
  return NextResponse.json({ ok: true, id });
});
