import { NextResponse } from "next/server";
import { readJson, route, str } from "@/lib/server/http";
import { ipTag } from "@/lib/server/rateLimit";
import { startPasswordReset } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { identifier } — public: email a password-reset link. Always answers the same, whether or not the account exists. */
export const POST = route(async (req) => {
  const body = await readJson(req, 1000);
  await startPasswordReset(str(body.identifier, "Username or email", { max: 200 }), ipTag(req), process.env.APP_URL || new URL(req.url).origin);
  return NextResponse.json({ ok: true });
});
