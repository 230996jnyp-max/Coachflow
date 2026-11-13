import { requireUser } from "@/lib/server/auth";
import { notFound, route } from "@/lib/server/http";
import { isGymKind, isKind, readGymMedia, readMedia } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — a picture, if the signed-in person is allowed to see it. The address carries ?v=<version>, so it can be cached for good. A gym's id (gym_…) gives its logo or banner. */
export const GET = route<{ params: Promise<{ userId: string; kind: string }> }>(async (_req, ctx) => {
  const { userId, kind } = await ctx.params;
  const me = await requireUser();
  let found: { mime: string; bytes: Buffer };
  if (userId.startsWith("gym_")) {
    if (!isGymKind(kind)) throw notFound();
    found = await readGymMedia(me, userId, kind);
  } else {
    if (!isKind(kind)) throw notFound();
    found = await readMedia(me, userId, kind);
  }
  return new Response(new Uint8Array(found.bytes), { headers: { "Content-Type": found.mime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
});
