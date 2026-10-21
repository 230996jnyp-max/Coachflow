import { NextResponse } from "next/server";
import { clearSession } from "@/lib/server/auth";
import { assertSameOrigin, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  await clearSession();
  return NextResponse.json({ ok: true });
});
