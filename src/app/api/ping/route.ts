import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET - answers "yes" and nothing else. The app asks it to tell whether the server can be reached (no sign-in, no database). */
export const GET = () => NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
