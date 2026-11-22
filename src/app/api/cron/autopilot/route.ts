import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runAll } from "@/lib/server/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

/** GET — the morning job (08:00 Singapore time, Vercel Cron sends `Authorization: Bearer CRON_SECRET`): lets go what was held overnight and looks for new events for every coach with a rule on. */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await runAll(new Date())) });
}
