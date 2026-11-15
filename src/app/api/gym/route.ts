import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { applyDefaultsToAll, audit, gymInfoFor, gymSettings, membershipOf, regenerateCode, requirePerm, updateGymSettings } from "@/lib/server/gymOrg";
import { gymOverview } from "@/lib/server/gymSchedule";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the signed-in coach's gym: their role and permissions, and (with portal access) the gym's settings and home numbers. */
export const GET = route(async () => {
  const me = await requireUser(["COACH", "OWNER"]);
  const info = await gymInfoFor(me.id);
  if (!info) return NextResponse.json({ gym: null });
  const m = await membershipOf(me.id);
  if (!m || info.status !== "ACTIVE" || info.perms.length === 0) return NextResponse.json({ gym: info });
  const settings = await gymSettings(m.gym);
  // Only people who run the team see the code.
  if (!m.perms.includes("coaches.manage")) settings.code = "";
  return NextResponse.json({ gym: info, settings, overview: await gymOverview(m) });
});

/** PATCH { name?, theme?, niches?, countNoShows? } — change the gym's name, defaults and hours rule. */
export const PATCH = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "branding.manage");
  await updateGymSettings(m, me, body);
  return NextResponse.json({ ok: true, settings: await gymSettings((await membershipOf(me.id))!.gym) });
});

/** POST { action: "regenerate_code" | "apply_all" } */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  if (body.action === "regenerate_code") {
    const m = await requirePerm(me, "coaches.manage");
    return NextResponse.json({ ok: true, code: await regenerateCode(m, me) });
  }
  if (body.action === "apply_all") {
    const m = await requirePerm(me, "branding.manage");
    const n = await applyDefaultsToAll(m.gym.id);
    await audit(m.gym.id, me.id, "defaults_applied_to_all", `${n} coaches`);
    return NextResponse.json({ ok: true, coaches: n });
  }
  throw badRequest("Unknown action.");
});
