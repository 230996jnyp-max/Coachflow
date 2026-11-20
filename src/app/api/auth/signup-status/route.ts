import { NextResponse } from "next/server";
import { createSession } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";
import { signupStatus } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { wait } — public: the signup page, which holds the secret it was given when the account was made, asks whether the email has been
 * confirmed yet (perhaps on another device). "waiting" until then; once confirmed, the secret is used up and this device is signed in.
 */
export const POST = route(async (req) => {
  const body = await readJson(req, 500);
  await hit(`signupwait:${ipTag(req)}`, 400, 600_000, "Please wait a moment.");
  const r = await signupStatus(body.wait);
  if (r.status !== "ok") return NextResponse.json({ status: r.status });
  await createSession(r.user, { remember: false });
  return NextResponse.json({ status: "ok", role: r.role });
});
