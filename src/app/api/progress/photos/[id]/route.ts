import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { MAX_PHOTO_CHARS, putPhoto, removePhoto } from "@/lib/server/bodyData";
import { badRequest, readJson, route } from "@/lib/server/http";
import { hit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT { photo } — save a progress photo (a shrunk JPEG as a data address). A photo never changes once saved. 40 new photos an hour per
 * person; `?mode=insert-only` (a device uploading what it kept locally) is not counted against that.
 */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req, MAX_PHOTO_CHARS + 5_000);
  const me = await requireUser();
  const { id } = await ctx.params;
  const p = body.photo as { id?: unknown } | undefined;
  if (!p || p.id !== id) throw badRequest("Photo does not match the address.");
  if (new URL(req.url).searchParams.get("mode") !== "insert-only") await hit(`photo:${me.id}`, 40, 3_600_000, "You've added a lot of photos this hour. Try again a little later.");
  await putPhoto(me, p);
  return NextResponse.json({ ok: true });
});

/** DELETE — remove a photo (its client, or that client's coach). */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  await removePhoto(me, id);
  return NextResponse.json({ ok: true });
});
