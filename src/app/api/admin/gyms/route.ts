import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { listGyms } from "@/lib/server/gymAdmin";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — owner only: every gym with its admin, code, how many coaches are linked and its AI use. Never client counts or names. */
export const GET = route(async () => {
  await requireUser(["OWNER"]);
  return NextResponse.json({ gyms: await listGyms() });
});
