import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { approveMember, cancelInvite, declineMember, inviteByEmail, listTeam, removeMember, requirePerm, requirePortal, setMemberDetails, setMemberRole } from "@/lib/server/gymOrg";
import { badRequest, readJson, route, str } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the people in the gym (and those waiting), with roles. Hourly rates only for people who manage the team or see payroll. */
export const GET = route(async () => {
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePortal(me);
  const team = await listTeam(m.gym.id);
  const seesRates = m.perms.includes("coaches.manage") || m.perms.includes("hours.view");
  return NextResponse.json({ people: team.people.map((p) => (seesRates ? p : { ...p, rateCents: null })), invites: m.perms.includes("coaches.manage") ? team.invites : [] });
});

/** POST { action, userId?, roleId?, email?, inviteId?, rate?, branchId? } */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const action = str(body.action, "Action", { max: 30 });
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (action === "set_role") {
    const m = await requirePerm(me, "roles.manage");
    await setMemberRole(m, me, userId, body.roleId);
    return NextResponse.json({ ok: true });
  }
  const m = await requirePerm(me, "coaches.manage");
  switch (action) {
    case "approve":
      await approveMember(m, me, userId, body.roleId);
      break;
    case "decline":
      await declineMember(m, me, userId);
      break;
    case "remove":
      await removeMember(m, me, userId);
      break;
    case "set_details":
      await setMemberDetails(m, me, userId, { ...("rate" in body ? { rate: body.rate } : {}), ...("branchId" in body ? { branchId: body.branchId } : {}) });
      break;
    case "invite": {
      const origin = process.env.APP_URL || new URL(req.url).origin;
      return NextResponse.json({ ok: true, ...(await inviteByEmail(m, me, body.email, body.roleId, origin)) });
    }
    case "cancel_invite":
      await cancelInvite(m, me, str(body.inviteId, "Invitation", { max: 80 }));
      break;
    default:
      throw badRequest("Unknown action.");
  }
  return NextResponse.json({ ok: true });
});
