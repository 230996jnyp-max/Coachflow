import { NextResponse } from "next/server";
import { deleteOwnAccount } from "@/lib/server/accountDelete";
import { requireUser } from "@/lib/server/auth";
import { assertSameOrigin, readJson, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { confirm: <username>, password? | token? } — the signed-in person deletes their own account for good. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(undefined, { skipBilling: true });
  const body = await readJson(req);
  await deleteOwnAccount(me, {
    confirm: typeof body.confirm === "string" ? body.confirm : "",
    password: typeof body.password === "string" ? body.password.slice(0, 200) : undefined,
    token: typeof body.token === "string" ? body.token.slice(0, 120) : undefined,
  });
  return NextResponse.json({ ok: true });
});
