import { NextResponse } from "next/server";
import { deletionInfo } from "@/lib/server/accountDelete";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — what the delete-account screen needs to word its warning. */
export const GET = route(async () => {
  const me = await requireUser(undefined, { skipBilling: true });
  return NextResponse.json(await deletionInfo(me));
});
