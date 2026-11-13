import { NextResponse } from "next/server";
import { lookupGym } from "@/lib/server/gymOrg";
import { notFound, readJson, route } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { code } — public: which gym is this? Gives its name only, and is limited so codes can't be guessed. */
export const POST = route(async (req) => {
  const body = await readJson(req, 500);
  await hit(`gymcode:${ipTag(req)}`, 20, 600_000, "Too many tries. Wait a few minutes, then check the code with your gym.");
  const g = await lookupGym(body.code);
  if (!g) throw notFound("We couldn't find a gym with that code.");
  return NextResponse.json({ name: g.name });
});
