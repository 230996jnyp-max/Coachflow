import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { listRequests, pendingCount } from "@/lib/server/signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — owner only: the coach sign-up requests (newest first). `?count=1` returns just how many are waiting. */
export const GET = route(async (req) => {
  await requireUser(["OWNER"]);
  if (new URL(req.url).searchParams.get("count") === "1") return NextResponse.json({ pending: await pendingCount() });
  return NextResponse.json(await listRequests());
});
