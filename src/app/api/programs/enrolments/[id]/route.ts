import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, route } from "@/lib/server/http";
import * as P from "@/lib/server/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
/** DELETE ?remove=1 — end a program for a client; with remove=1 the coming workouts are deleted too. */
export const DELETE = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const me = await requireUser();
  const { id } = await ctx.params;
  const remove = new URL(req.url).searchParams.get("remove") === "1";
  return NextResponse.json(await P.endEnrolment(me, id, remove));
});
