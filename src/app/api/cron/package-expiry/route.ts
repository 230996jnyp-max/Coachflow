import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { packageExpiryAlerts } from "@/lib/server/creditAlerts";

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

/** GET — the daily job (Vercel Cron sends `Authorization: Bearer CRON_SECRET`): tells clients and coaches when a package with sessions left ends in a week or tomorrow. */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await packageExpiryAlerts()) });
}
