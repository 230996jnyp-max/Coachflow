import { NextResponse } from "next/server";
import { bootstrapFor } from "@/lib/server/accounts";
import { currentUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — who am I, plus the accounts I'm allowed to see (a coach sees only their own clients). 401 when signed out. */
export const GET = route(async () => {
  const me = await currentUser();
  if (!me) return NextResponse.json({ user: null }, { status: 401 });
  const data = await bootstrapFor(me);
  return NextResponse.json({ user: data.me, users: data.users, clients: data.clients });
});
