import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { readJson, route } from "@/lib/server/http";
import { removePackage, savePackage } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT — change a package (payments already made keep the package as it was sold). */
export const PUT = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req, 4_000);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  return NextResponse.json({ package: await savePackage(me, body, id) });
});

/** DELETE — stop selling a package (it is switched off, not erased). */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  await removePackage(me, id);
  return NextResponse.json({ ok: true });
});
