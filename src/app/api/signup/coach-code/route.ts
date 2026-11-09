import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";
import { lookupCoach } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { code } — public: whose code is this? Gives a short name only, and is limited so codes can't be guessed. */
export const POST = route(async (req) => {
  const body = await readJson(req, 500);
  await hit(`code:${ipTag(req)}`, 20, 600_000, "Too many tries. Wait a few minutes, then check the code with your coach.");
  return NextResponse.json(await lookupCoach(body.code));
});
