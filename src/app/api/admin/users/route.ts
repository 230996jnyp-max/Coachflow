import { NextResponse } from "next/server";
import { addUser } from "@/lib/server/adminUsers";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { kind: coach | gym | solo | client, name, email, exempt?, gymName?, coachId? } — owner adds a user. The temporary password is emailed and shown once. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  await requireUser(["OWNER"]);
  const body = await readJson(req);
  const origin = process.env.APP_URL || new URL(req.url).origin;
  return NextResponse.json(await addUser(body, origin));
});
