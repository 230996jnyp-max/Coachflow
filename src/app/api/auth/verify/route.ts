import { NextResponse } from "next/server";
import { createSession } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";
import { confirmEmail } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { token } — public: the link in the confirmation email. Whoever opens it proves the address is theirs, so they are let straight in
 * on this device (no second sign-in). An account the owner has switched off is not signed in.
 */
export const POST = route(async (req) => {
  const body = await readJson(req, 1000);
  await hit(`verify:${ipTag(req)}`, 30, 600_000);
  if (typeof body.token !== "string") throw badRequest("This link isn't valid.");
  const { user, ...out } = await confirmEmail(body.token);
  let signedIn = false;
  if (user.active) {
    await createSession(user, { remember: false });
    signedIn = true;
  }
  return NextResponse.json({ ok: true, signedIn, ...out });
});
