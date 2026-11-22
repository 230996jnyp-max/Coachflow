import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { adminConsults } from "@/lib/server/consult";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the platform owner: consult reports (with the app's record and a recommended action), recent consults, totals and blocks. */
export const GET = route(async () => {
  await requireUser(["OWNER"]);
  return NextResponse.json(await adminConsults());
});
