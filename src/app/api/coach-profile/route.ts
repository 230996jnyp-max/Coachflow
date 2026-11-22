import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { myPublicProfile, saveMyPublicProfile } from "@/lib/server/coachPublic";
import { assertSameOrigin, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the coach's public profile page settings (and whether they take consults). */
export const GET = route(async () => {
  const me = await requireUser(["COACH", "OWNER"]);
  return NextResponse.json(await myPublicProfile(me));
});

/** PUT { isPublic?, takesConsults?, data? } — change them. */
export const PUT = route(async (req) => {
  assertSameOrigin(req);
  const body = await readJson(req);
  const me = await requireUser(["COACH", "OWNER"]);
  return NextResponse.json(await saveMyPublicProfile(me, body));
});
