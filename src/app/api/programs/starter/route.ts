import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { starterId } — start from one of the six ready-made programs. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  return NextResponse.json({ program: await P.createFromStarter(me, body.starterId) });
});
