import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { sealProfile } from "@/lib/server/accounts";
import { hashPassword, requireUser } from "@/lib/server/auth";
import { tempPassword } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { conflict, email, isUniqueViolation, readJson, route, str } from "@/lib/server/http";
import { users } from "@/lib/server/schema";
import { sendCredentialsEmail } from "@/lib/server/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — owner-only roster of staff with AGGREGATE client counts. No client data (names, profiles, notes, workouts)
 * is selected or decrypted here — only `count(*)` per coach.
 */
export const GET = route(async () => {
  await requireUser(["OWNER"]);
  const d = await db();
  const staff = await d.select().from(users).where(inArray(users.role, ["OWNER", "COACH"]));
  const counts = await d
    .select({ coachId: users.coachId, total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${users.active})::int` })
    .from(users)
    .where(eq(users.role, "CLIENT"))
    .groupBy(users.coachId);
  const byCoach = new Map(counts.map((c) => [c.coachId, c]));
  const coaches = staff
    .map((s) => ({
      id: s.id,
      name: s.name ?? s.username,
      email: s.email ?? "",
      role: s.role as "OWNER" | "COACH",
      active: s.active,
      mustChangePassword: s.mustChangePassword,
      createdAt: s.createdAt.toISOString(),
      clientCount: byCoach.get(s.id)?.total ?? 0,
      activeClientCount: byCoach.get(s.id)?.active ?? 0,
    }))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "OWNER" ? -1 : 1));
  return NextResponse.json({
    coaches,
    totals: {
      coaches: coaches.length,
      activeCoaches: coaches.filter((c) => c.active).length,
      clients: coaches.reduce((n, c) => n + c.clientCount, 0),
    },
  });
});

/** POST { name, email } — create a coach. The temporary password is emailed to that coach and shown once to the owner. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  await requireUser(["OWNER"]);
  const name = str(body.name, "Name", { max: 100 });
  const address = email(body.email, "Email");
  const password = tempPassword();
  const id = `u_${randomUUID()}`;

  const d = await db();
  try {
    await d.insert(users).values({
      id,
      role: "COACH",
      username: address,
      passwordHash: await hashPassword(password),
      name,
      email: address,
      profileEnc: sealProfile(id, {}),
      mustChangePassword: true,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A coach with that email already exists.");
    throw e;
  }
  const origin = process.env.APP_URL || new URL(req.url).origin;
  const mail = await sendCredentialsEmail({ to: address, name, username: address, password, origin });
  return NextResponse.json({ coach: { id, name, email: address }, temporaryPassword: password, email: { status: mail.status, error: mail.error } });
});
