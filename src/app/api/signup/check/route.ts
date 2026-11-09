import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";
import { availability } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { username?, email? } — public: is this username / email free to use? (limited, so it can't be used to list who has an account) */
export const POST = route(async (req) => {
  const body = await readJson(req, 2000);
  await hit(`check:${ipTag(req)}`, 40, 600_000, "Slow down a little and try again.");
  return NextResponse.json(await availability({ username: typeof body.username === "string" ? body.username : undefined, email: typeof body.email === "string" ? body.email : undefined }));
});
