import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendTrialReminders } from "@/lib/server/billing";
import { retryPendingRewards } from "@/lib/server/referrals";

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

/** GET — the daily scheduled job (Vercel Cron sends `Authorization: Bearer CRON_SECRET`): emails coaches whose free trial ends in a week or tomorrow. */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const sent = await sendTrialReminders(process.env.APP_URL || new URL(req.url).origin);
  const rewards = await retryPendingRewards(); // referral free months that could not be given yet
  return NextResponse.json({ ok: true, ...sent, rewards });
}
