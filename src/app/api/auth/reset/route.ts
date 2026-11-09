import { NextResponse } from "next/server";
import { badRequest, readJson, route } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";
import { finishPasswordReset } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { token, password } — public: choose a new password with the emailed link. Signs every device out. */
export const POST = route(async (req) => {
  const body = await readJson(req, 2000);
  await hit(`reset:${ipTag(req)}`, 20, 600_000);
  if (typeof body.token !== "string") throw badRequest("This link isn't valid.");
  await finishPasswordReset(body.token, body.password);
  return NextResponse.json({ ok: true });
});
