import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { notFound, readJson, route, str } from "@/lib/server/http";
import { gyms } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { id?, name, address?, active? } — create or update one of the coach's saved gyms. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const name = str(body.name, "Name", { max: 100 });
  const address = str(body.address, "Address", { optional: true, max: 200 });
  const active = typeof body.active === "boolean" ? body.active : true;
  const d = await db();

  if (typeof body.id === "string" && body.id) {
    const [row] = await d.update(gyms).set({ name, address, active }).where(and(eq(gyms.id, body.id), eq(gyms.coachId, me.id))).returning();
    if (!row) throw notFound("Gym not found.");
    return NextResponse.json({ gym: { id: row.id, name: row.name, address: row.address, active: row.active } });
  }
  const id = `g_${randomUUID()}`;
  await d.insert(gyms).values({ id, coachId: me.id, name, address, active });
  return NextResponse.json({ gym: { id, name, address, active } });
});
