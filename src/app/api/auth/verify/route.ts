import { NextResponse } from "next/server";
import { badRequest, readJson, route } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";
import { confirmEmail } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { token } — public: the link in the confirmation email. */
export const POST = route(async (req) => {
  const body = await readJson(req, 1000);
  await hit(`verify:${ipTag(req)}`, 30, 600_000);
  if (typeof body.token !== "string") throw badRequest("This link isn't valid.");
  return NextResponse.json({ ok: true, ...(await confirmEmail(body.token)) });
});
