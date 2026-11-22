import { NextResponse } from "next/server";
import { route } from "@/lib/server/http";
import { readPending, suggestUsername } from "@/lib/server/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — public: someone who came back from Google, Facebook or Microsoft with no account yet: who they are, so the signup form can be
 * filled in (name, email, a suggested username). `null` when there is no such sign-in in progress.
 */
export const GET = route(async () => {
  const p = await readPending();
  if (!p) return NextResponse.json({ pending: null });
  return NextResponse.json({ pending: { provider: p.provider, email: p.email, name: p.name, trusted: p.trusted, username: await suggestUsername(p.email, p.name) } });
});
