import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { assertCanJoinGroup, assertCoach, coachAddMember, loadGroups, requireGroup, shareBookingAsCoach, undoShare } from "@/lib/server/groups";
import { badRequest, readJson, route, str } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { groupId } or { bookingId }, plus { clientId }. Coach only. Gym floor: adds one of the coach's clients to the session on the spot.
 * A 1-on-1 becomes a partner session first; the new person uses one of their group credits like anyone booked in advance.
 * Returns the refreshed class screens and the id of the group the person joined.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const clientId = str(body.clientId, "Client", { max: 80 });
  if (typeof body.groupId === "string" && body.groupId) {
    const g = await requireGroup(body.groupId);
    assertCoach(me, g);
    await coachAddMember(me, g, clientId);
    return NextResponse.json({ ...(await loadGroups(me)), groupId: g.id });
  }
  if (typeof body.bookingId !== "string" || !body.bookingId) throw badRequest("Choose the session.");
  // Check the newcomer first, so a refused walk-in never leaves the 1-on-1 turned into a partner session.
  await assertCanJoinGroup(me, clientId);
  const { group, created } = await shareBookingAsCoach(me, body.bookingId);
  try {
    await coachAddMember(me, group, clientId);
  } catch (e) {
    if (created) await undoShare(group);
    throw e;
  }
  return NextResponse.json({ ...(await loadGroups(me)), groupId: group.id });
});
