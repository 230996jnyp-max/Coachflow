import { requireUser } from "@/lib/server/auth";
import { notFound, route } from "@/lib/server/http";
import { isKind, readMedia } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — a picture, if the signed-in person is allowed to see it. The address carries ?v=<version>, so it can be cached for good. */
export const GET = route<{ params: Promise<{ userId: string; kind: string }> }>(async (_req, ctx) => {
  const { userId, kind } = await ctx.params;
  if (!isKind(kind)) throw notFound();
  const me = await requireUser();
  const { mime, bytes } = await readMedia(me, userId, kind);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
});
