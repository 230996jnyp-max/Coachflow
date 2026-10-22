import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { GOALS, sealProfile, toProfile, toUser, type ProfileJson } from "@/lib/server/accounts";
import { hashPassword, requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { badRequest, checkPassword, conflict, email, int, isUniqueViolation, readJson, route, str } from "@/lib/server/http";
import { users } from "@/lib/server/schema";
import type { ClientGoal } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — a coach creates a client account (assigned to that coach). */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);

  const name = str(body.name, "Name", { max: 100 });
  const username = str(body.username, "Username", { min: 3, max: 32 }).toLowerCase();
  if (!/^[a-z0-9_.-]+$/.test(username)) throw badRequest("Username can only use letters, numbers, dots, dashes and underscores.");
  const password = checkPassword(body.password, "Temporary password");
  const goal = GOALS.includes(body.goal as ClientGoal) ? (body.goal as ClientGoal) : "General Fitness";

  const id = `u_${randomUUID()}`;
  const profile: ProfileJson = {
    name,
    phone: str(body.phone, "Phone", { optional: true, max: 40 }),
    email: email(body.email, "Email", true),
    goal,
    credits: int(body.credits ?? 0, "Credits", 0, 1000),
    packageSize: int(body.credits ?? 0, "Credits", 0, 1000),
    defaultGymId: typeof body.defaultGymId === "string" && body.defaultGymId ? body.defaultGymId.slice(0, 140) : null,
    medicalNotes: str(body.medicalNotes, "Medical notes", { optional: true, max: 2000 }),
    startDate: new Date().toISOString().slice(0, 10),
    groupClassCredits: int(body.groupClassCredits ?? 0, "Group class credits", 0, 1000),
  };

  const d = await db();
  try {
    const [row] = await d
      .insert(users)
      .values({
        id,
        role: "CLIENT",
        username,
        passwordHash: await hashPassword(password),
        profileEnc: sealProfile(id, profile),
        coachId: me.id,
        mustChangePassword: true,
      })
      .returning();
    return NextResponse.json({ user: toUser(row), profile: toProfile(row) });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("That username is already taken.");
    throw e;
  }
});
