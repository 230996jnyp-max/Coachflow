import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { coachBusiness, gymBusiness, ownerBusiness } from "@/lib/server/business";
import { badRequest, forbidden, route } from "@/lib/server/http";
import { membershipOf } from "@/lib/server/gymOrg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?view=coach | gym | owner — the business dashboards. A coach sees their own; a gym admin (schedule or hours permission) sees the gym's
 * counts; only the owner sees the platform. Without `view`, answers which views this person has.
 */
export const GET = route(async (req) => {
  const me = await requireUser(["OWNER", "COACH"], { skipBilling: true });
  const view = new URL(req.url).searchParams.get("view");
  if (!view) {
    const m = await membershipOf(me.id);
    const gym = !!m && m.member.status === "ACTIVE" && m.gym.status === "ACTIVE" && (m.perms.includes("schedule.view") || m.perms.includes("hours.view"));
    return NextResponse.json({ views: { coach: true, gym, owner: me.role === "OWNER" } });
  }
  if (view === "coach") return NextResponse.json(await coachBusiness(me));
  if (view === "gym") return NextResponse.json(await gymBusiness(me));
  if (view === "owner") {
    if (me.role !== "OWNER") throw forbidden("Only the owner can see the platform numbers.");
    return NextResponse.json(await ownerBusiness());
  }
  throw badRequest("Unknown view.");
});
