import { NextResponse } from "next/server";
import { ownerDecide, ownerOverview, ownerSetRule } from "@/lib/server/aiReview";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route, str } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — owner only: the coaches' monthly AI reviews (held ones first) and the rules they taught the AI trainer. */
export const GET = route(async () => {
  await requireUser(["OWNER"]);
  return NextResponse.json(await ownerOverview());
});

/** POST { action: "approve" | "reject", id, note? } decides a held review. POST { action: "rule", id, active } switches a rule on or off. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER"]);
  if (body.action === "approve" || body.action === "reject") {
    await ownerDecide(me, str(body.id, "Review", { max: 80 }), body.action === "approve", body.note);
    return NextResponse.json({ ok: true, ...(await ownerOverview()) });
  }
  if (body.action === "rule") {
    if (typeof body.active !== "boolean") throw badRequest("active must be true or false.");
    await ownerSetRule(str(body.id, "Rule", { max: 80 }), body.active);
    return NextResponse.json({ ok: true, ...(await ownerOverview()) });
  }
  throw badRequest("Unknown action.");
});
