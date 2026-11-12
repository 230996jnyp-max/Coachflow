import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { deleteMedia, isKind, putMedia } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string }> };

/** PUT { mime, data } — replace your own picture (kind: avatar, bg, banner, logo). Banner and logo are for coaches. */
export const PUT = route<Ctx>(async (req, ctx) => {
  const { kind } = await ctx.params;
  if (!isKind(kind)) throw badRequest("Unknown picture type.");
  const body = await readJson(req, 1_500_000);
  const me = await requireUser();
  if ((kind === "banner" || kind === "logo") && me.role === "CLIENT") throw badRequest("Banner and logo are for coaches.");
  const prefs = await putMedia(me, kind, body.mime, body.data);
  return NextResponse.json({ ok: true, prefs });
});

/** DELETE — remove your own picture. */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const { kind } = await ctx.params;
  if (!isKind(kind)) throw badRequest("Unknown picture type.");
  const me = await requireUser();
  const prefs = await deleteMedia(me, kind);
  return NextResponse.json({ ok: true, prefs });
});
