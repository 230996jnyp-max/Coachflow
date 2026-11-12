import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { route } from "@/lib/server/http";
import { aiWaitlist } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — owner-only: the addresses waiting for the AI personal trainer, oldest first. */
export const GET = route(async () => {
  await requireUser(["OWNER"]);
  const d = await db();
  const rows = await d.select({ email: aiWaitlist.email, interest: aiWaitlist.interest, createdAt: aiWaitlist.createdAt }).from(aiWaitlist).orderBy(asc(aiWaitlist.createdAt)).limit(5000);
  return NextResponse.json({ list: rows.map((r) => ({ email: r.email, interest: r.interest, createdAt: r.createdAt.toISOString() })) });
});
