import { NextResponse } from "next/server";
import { sendIntakeReminders } from "@/lib/server/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — the daily job: reminds clients who still owe their "Before we meet" forms and have a session in the next 24 hours. Vercel calls it
 * with "Authorization: Bearer <CRON_SECRET>". Each request is only reminded once, so running it twice does no harm.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  return NextResponse.json({ reminded: await sendIntakeReminders() });
}
