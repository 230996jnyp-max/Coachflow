import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";
import { approveRequest, declineRequest } from "@/lib/server/legacyRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** POST { action: "approve" | "decline" } — owner only. Approving creates the coach and emails their login; declining emails the applicant. */
export const POST = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const owner = await requireUser(["OWNER"]);
  const { id } = await ctx.params;
  if (body.action === "approve") return NextResponse.json({ request: await approveRequest(owner, id, process.env.APP_URL || new URL(req.url).origin) });
  if (body.action === "decline") return NextResponse.json(await declineRequest(owner, id));
  throw badRequest("Unknown action.");
});
