import { NextResponse } from "next/server";
import { notFound, readJson, route } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";
import { lookupReferrer } from "@/lib/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { code } — public: whose referral code is this? Gives a first name only, and is limited so codes can't be guessed. */
export const POST = route(async (req) => {
  const body = await readJson(req, 500);
  await hit(`refcode:${ipTag(req)}`, 20, 600_000, "Too many tries. Wait a few minutes, then check the code with the coach who invited you.");
  const r = await lookupReferrer(body.code);
  if (!r) throw notFound("We couldn't find that referral code.");
  return NextResponse.json({ name: r.name });
});
