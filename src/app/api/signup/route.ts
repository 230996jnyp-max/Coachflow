import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { ipTag } from "@/lib/server/rateLimit";
import { clearPendingCookie, readPending } from "@/lib/server/social";
import { createAccount, parseSignup, verifyCaptcha, type SocialSignup } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST — public: makes a Coach, Gym, Client or Personal account.
 * With a password and an email: it can sign in once the emailed link is opened (the response carries `wait`, the secret the waiting
 * signup page uses to be let in the moment that happens).
 * With `social: true`: they came back from Google, Facebook or Microsoft (a signed cookie holds who they are). The email is the one the
 * provider gave; Google confirms it, so the account is ready and this device is signed in (`signedIn`); for the others the usual
 * confirmation email is sent.
 */
export const POST = route(async (req) => {
  let body = await readJson(req);
  // A hidden field real people never fill in: bots do. They get the same "thanks" and nothing is stored.
  if (typeof body.website === "string" && body.website.trim()) return NextResponse.json({ ok: true });

  let social: SocialSignup | undefined;
  if (body.social === true) {
    const pending = await readPending();
    if (!pending) throw badRequest("Your sign-in with Google, Facebook or Microsoft has timed out. Please start again.");
    social = { provider: pending.provider, subject: pending.subject, trusted: pending.trusted };
    // The address comes from the provider, never from the form. The password is a long random one nobody sees: they sign in with the
    // provider, or choose a password later with "Forgot your password?".
    body = { ...body, email: pending.email, password: `${randomBytes(24).toString("base64url")}aA1!` };
  }
  const input = parseSignup(body);
  const ip = ipTag(req);
  if (!social) await verifyCaptcha(body.captcha, (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim());
  const out = await createAccount(input, ip, process.env.APP_URL || new URL(req.url).origin, social);
  if (social) await clearPendingCookie();
  if (out.verified) await createSession(out.user, { remember: false });
  return NextResponse.json({ ok: true, email: out.email, role: out.role, wait: out.wait, signedIn: out.verified });
});
