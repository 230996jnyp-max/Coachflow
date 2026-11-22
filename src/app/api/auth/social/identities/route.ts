import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { enabledProviders } from "@/lib/server/social";
import { identitiesOf } from "@/lib/server/socialStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the signed-in person's connected ways to sign in, and the ones they could still connect. */
export const GET = route(async () => {
  const me = await requireUser(undefined, { skipBilling: true });
  return NextResponse.json({ linked: await identitiesOf(me.id), available: enabledProviders() });
});
