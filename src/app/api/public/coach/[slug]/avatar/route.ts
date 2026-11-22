import { publicAvatar } from "@/lib/server/coachPublic";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — a coach's profile photo for their public page (only while the page is switched on). No sign-in needed. */
export const GET = route<{ params: Promise<{ slug: string }> }>(async (_req, ctx) => {
  const { slug } = await ctx.params;
  const found = await publicAvatar(slug);
  return new Response(new Uint8Array(found.bytes), { headers: { "Content-Type": found.mime, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
});
