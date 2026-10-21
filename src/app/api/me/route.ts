import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { badRequest, readJson, route } from "@/lib/server/http";
import { users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { unit } — personal preferences. */
export const PATCH = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  if (body.unit !== "metric" && body.unit !== "imperial") throw badRequest("Unit must be metric or imperial.");
  const d = await db();
  await d.update(users).set({ unit: body.unit, updatedAt: new Date() }).where(eq(users.id, me.id));
  return NextResponse.json({ ok: true });
});
