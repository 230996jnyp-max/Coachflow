import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { audit, gymSettings, membershipOf, requirePerm } from "@/lib/server/gymOrg";
import { badRequest, readJson, route } from "@/lib/server/http";
import { deleteGymMedia, isGymKind, putGymMedia } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string }> };

async function reply(userId: string) {
  const m = await membershipOf(userId);
  const s = m ? await gymSettings(m.gym) : null;
  return NextResponse.json({ ok: true, logoV: s?.logoV ?? 0, bannerV: s?.bannerV ?? 0 });
}

/** PUT { mime, data } — the gym's logo or banner. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const { kind } = await ctx.params;
  if (!isGymKind(kind)) throw badRequest("Unknown picture type.");
  const body = await readJson(req, 1_500_000);
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "branding.manage");
  await putGymMedia(m.gym.id, kind, body.mime, body.data);
  await audit(m.gym.id, me.id, "branding_picture", kind);
  return reply(me.id);
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const { kind } = await ctx.params;
  if (!isGymKind(kind)) throw badRequest("Unknown picture type.");
  const me = await requireUser(["COACH", "OWNER"]);
  const m = await requirePerm(me, "branding.manage");
  await deleteGymMedia(m.gym.id, kind);
  return reply(me.id);
});
