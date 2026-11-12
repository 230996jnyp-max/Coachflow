import { requireUser } from "@/lib/server/auth";
import { getPhotoImage } from "@/lib/server/bodyData";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — the picture itself, for the client and their coach only (the cookie is sent with the image request). A photo's picture never
 * changes, so the browser may keep it privately; `private` keeps it out of shared caches.
 */
export const GET = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  const { mime, bytes } = await getPhotoImage(me, id);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": mime, "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
});
