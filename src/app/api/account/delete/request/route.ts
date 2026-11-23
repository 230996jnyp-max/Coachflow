import { NextResponse } from "next/server";
import { emailDeletionLink } from "@/lib/server/accountDelete";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — emails the signed-in person a one-hour link that confirms deleting their account. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(undefined, { skipBilling: true });
  const origin = process.env.APP_URL || new URL(req.url).origin;
  return NextResponse.json(await emailDeletionLink(me, origin));
});
