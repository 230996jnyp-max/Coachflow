import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";
import { beginOAuth, setStateCookie, SocialError, type Mode } from "@/lib/server/social";
import { isProvider } from "@/lib/server/socialStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

const back = (mode: Mode) => (mode === "signup" ? "/signup" : mode === "link" ? "/settings/profile" : "/login");

/**
 * GET ?mode=login|signup|link — the "Continue with…" buttons are plain links to this: it sets a signed cookie holding the state and the
 * PKCE secret, then sends the browser to the provider. `link` (a signed-in person connecting another way to sign in) needs a session.
 */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { provider } = await ctx.params;
  const origin = process.env.APP_URL || new URL(req.url).origin;
  const asked = new URL(req.url).searchParams.get("mode");
  const mode: Mode = asked === "signup" || asked === "link" ? asked : "login";
  const to = (code: string) => NextResponse.redirect(new URL(`${back(mode)}?social=${code}`, origin));
  try {
    await hit(`social:${ipTag(req)}`, 60, 600_000);
    if (!isProvider(provider)) return to("unavailable");
    let userId: string | undefined;
    if (mode === "link") {
      const me = await currentUser();
      if (!me) return NextResponse.redirect(new URL("/login", origin));
      userId = me.id;
    }
    const { url, cookie } = await beginOAuth(provider, mode, origin, userId);
    await setStateCookie(cookie);
    return NextResponse.redirect(url);
  } catch (e) {
    if (e instanceof SocialError) return to("unavailable");
    if (e instanceof HttpError && e.status === 429) return to("busy");
    console.error("social start failed", e instanceof Error ? e.message : e);
    return to("error");
  }
}
