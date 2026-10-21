import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { loadSchedule } from "@/lib/server/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the signed-in user's scheduling data: their coach's rules, gyms and availability, plus bookings (clients see only their own in detail). */
export const GET = route(async () => {
  const me = await requireUser();
  return NextResponse.json(await loadSchedule(me));
});
