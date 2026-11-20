import { NextResponse } from "next/server";
import { createSession } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";
import { clearStateCookie, completeOAuth, modeOf, readStateCookie, resolveSocial, setPendingCookie, SocialError, type Mode } from "@/lib/server/social";
import { isProvider } from "@/lib/server/socialStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

const back = (mode: Mode) => (mode === "signup" ? "/signup" : mode === "link" ? "/settings/profile" : "/login");

/**
 * GET — where the provider sends the browser back (this address is what gets registered with Google, Facebook and Microsoft).
 * Checks the state, reads who they are and then: signs them in, or takes them on to finish signing up, or says why not.
 */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { provider } = await ctx.params;
  const origin = process.env.APP_URL || new URL(req.url).origin;
  const u = new URL(req.url);
  const cookie = await readStateCookie();
  const mode: Mode = (await modeOf(cookie)) ?? "login";
  const go = (path: string) => NextResponse.redirect(new URL(path, origin));
  const fail = (code: string) => go(`${back(mode)}?social=${code}`);
  try {
    await hit(`social:${ipTag(req)}`, 60, 600_000);
    if (!isProvider(provider)) return fail("unavailable");
    if (u.searchParams.get("error")) throw new SocialError("denied");
    const code = u.searchParams.get("code") ?? "";
    if (!code || code.length > 2000) throw new SocialError("state");
    const done = await completeOAuth(provider, { code, state: u.searchParams.get("state") ?? "", cookie, origin });
    await clearStateCookie();
    const out = await resolveSocial(done.mode, done.profile, done.userId);
    switch (out.kind) {
      case "signin":
        await createSession(out.user, { remember: false });
        return go("/auth/done");
      case "new":
        await setPendingCookie(out.pending);
        return go(`/signup?social=1${done.mode === "login" ? "&from=login" : ""}`);
      case "exists":
        return go(`/signup?social=exists&provider=${provider}`);
      case "conflict":
        return go(`/login?social=conflict&provider=${provider}`);
      case "disabled":
        return go(`${back(done.mode)}?social=disabled`);
      case "unverified":
        return go(`${back(done.mode)}?social=unverified`);
      case "no_email":
        return go(`${back(done.mode)}?social=noemail&provider=${provider}`);
      case "linked":
        return go(`/settings/profile?linked=${provider}`);
      case "link_taken":
        return go("/settings/profile?social=taken");
    }
  } catch (e) {
    await clearStateCookie().catch(() => undefined);
    if (e instanceof SocialError) return fail(e.code === "denied" ? "denied" : "error");
    if (e instanceof HttpError && e.status === 429) return fail("busy");
    console.error("social callback failed", e instanceof Error ? e.message : e);
    return fail("error");
  }
}
