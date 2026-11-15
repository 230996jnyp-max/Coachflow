import { NextResponse } from "next/server";
import { ACCOUNT_ACTIONS, applyAccountAction, type AccountAction } from "@/lib/server/accountAdmin";
import { requireUser } from "@/lib/server/auth";
import { badRequest, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { action, reason?, confirmEmail? } — the owner disables, re-enables or permanently deletes an account, re-sends the confirmation
 * email, or forces a password reset. The person is emailed about it. Deleting needs the account's email typed back as confirmation.
 */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER"]);
  const { id } = await ctx.params;
  const action = body.action as AccountAction;
  if (!ACCOUNT_ACTIONS.includes(action)) throw badRequest("Unknown action.");
  const origin = process.env.APP_URL || new URL(req.url).origin;
  const result = await applyAccountAction(me, id, action, {
    reason: typeof body.reason === "string" ? body.reason : "",
    confirmEmail: typeof body.confirmEmail === "string" ? body.confirmEmail : "",
    origin,
  });
  return NextResponse.json(result);
});
