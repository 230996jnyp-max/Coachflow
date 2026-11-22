import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { acceptConsult, cancelConsult, consultFor, endConsult, joinConsult, rateConsult, reportConsult } from "@/lib/server/consult";
import { assertSameOrigin, badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET — one consult, for the person or the trainer in it. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json(await consultFor(me, id));
});

/** POST { action: accept | join | end | cancel | rate | report, ... }. */
export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const body = await readJson(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  switch (body.action) {
    case "accept":
      return NextResponse.json(await acceptConsult(me, id));
    case "join":
      return NextResponse.json(await joinConsult(me, id));
    case "end":
      return NextResponse.json(await endConsult(me, id));
    case "cancel":
      return NextResponse.json(await cancelConsult(me, id));
    case "rate":
      return NextResponse.json(await rateConsult(me, id, body));
    case "report":
      return NextResponse.json(await reportConsult(me, id, body));
    default:
      throw badRequest("Unknown action.");
  }
});
