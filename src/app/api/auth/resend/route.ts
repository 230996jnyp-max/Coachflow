import { NextResponse } from "next/server";
import { readJson, route, str } from "@/lib/server/http";
import { ipTag } from "@/lib/server/rateLimit";
import { resendVerification } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { identifier } — public: send the confirmation email again. Always answers the same, whether or not the account exists. */
export const POST = route(async (req) => {
  const body = await readJson(req, 1000);
  await resendVerification(str(body.identifier, "Username or email", { max: 200 }), ipTag(req), process.env.APP_URL || new URL(req.url).origin);
  return NextResponse.json({ ok: true });
});
