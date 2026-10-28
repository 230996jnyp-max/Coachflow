import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { GOALS, loadClientFor, openProfile, parseUsername, sealProfile, setUsername, toProfile, toUser } from "@/lib/server/accounts";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { badRequest, email, int, notFound, readJson, route, str } from "@/lib/server/http";
import { logCredit } from "@/lib/server/credits";
import { applyHomeAddress, rulesFor } from "@/lib/server/schedule";
import { CORE_SPORTS, cleanSports } from "@/lib/sports";
import { purgeClientGroups } from "@/lib/server/groups";
import { bookings, messages, users } from "@/lib/server/schema";
import { purgeClientTraining } from "@/lib/server/training";
import type { ClientGoal } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — a coach edits one of their own clients (name, contact, goal, notes, credits, active). */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  const row = await loadClientFor(me, id);
  if (!row) throw notFound("Client not found.");

  // The coach can rename a client's sign-in (for example when they forget it). Their sessions stay signed in.
  if ("username" in body) {
    const username = parseUsername(body.username, false);
    if (username !== row.username) await setUsername(id, username);
  }

  const p = openProfile(row);
  const before = { credits: p.credits, group: p.groupClassCredits ?? 0 };
  if ("name" in body) p.name = str(body.name, "Name", { max: 100 });
  if ("phone" in body) p.phone = str(body.phone, "Phone", { optional: true, max: 40 });
  if ("email" in body) p.email = email(body.email, "Email", true);
  if ("goal" in body) {
    if (!GOALS.includes(body.goal as ClientGoal)) throw badRequest("Unknown goal.");
    p.goal = body.goal as ClientGoal;
  }
  if ("medicalNotes" in body) p.medicalNotes = str(body.medicalNotes, "Medical notes", { optional: true, max: 2000 });
  if ("credits" in body) p.credits = int(body.credits, "Credits", 0, 1000);
  // Relative changes are safest: attendance may have moved the balance since this browser last looked.
  if ("creditsDelta" in body) p.credits = Math.max(0, Math.min(1000, p.credits + int(body.creditsDelta, "Credits", -1000, 1000)));
  if ("groupCreditsDelta" in body) p.groupClassCredits = Math.max(0, Math.min(1000, (p.groupClassCredits ?? 0) + int(body.groupCreditsDelta, "Group class credits", -1000, 1000)));
  if ("groupClassCredits" in body) p.groupClassCredits = int(body.groupClassCredits, "Group class credits", 0, 1000);
  if ("packageSize" in body) p.packageSize = int(body.packageSize, "Package size", 0, 1000);
  if (body.setPackageToBalance === true) p.packageSize = p.credits;
  if ("homeAddress" in body) applyHomeAddress(p, body.homeAddress);
  if ("focuses" in body) {
    // The coach assigns what this client trains: built-in disciplines or sports the coach added. Empty = everything.
    const allowed: string[] = [...CORE_SPORTS, ...(await rulesFor(me.id)).sports];
    const focuses = cleanSports(body.focuses, 6).filter((f) => allowed.includes(f));
    if (focuses.length) p.focuses = focuses;
    else delete p.focuses;
  }
  if ("defaultGymId" in body) p.defaultGymId = typeof body.defaultGymId === "string" && body.defaultGymId ? body.defaultGymId.slice(0, 140) : null;

  const d = await db();
  const [updated] = await d
    .update(users)
    .set({
      profileEnc: sealProfile(id, p),
      updatedAt: new Date(),
      ...(typeof body.archived === "boolean" ? { active: !body.archived, tokenVersion: body.archived ? row.tokenVersion + 1 : row.tokenVersion } : {}),
    })
    .where(and(eq(users.id, id), eq(users.coachId, me.id)))
    .returning();
  if (!updated) throw notFound("Client not found.");
  // Credit changes made by the coach go in the client's credit log.
  if (p.credits !== before.credits) await logCredit({ clientId: id, coachId: me.id, pool: "SESSION", kind: "ADJUSTMENT", delta: p.credits - before.credits, sessionType: "1-on-1 PT", label: "Coach manual adjustment", balance: p.credits });
  if ((p.groupClassCredits ?? 0) !== before.group) await logCredit({ clientId: id, coachId: me.id, pool: "GROUP", kind: "ADJUSTMENT", delta: (p.groupClassCredits ?? 0) - before.group, sessionType: "Group Class", label: "Coach manual adjustment", balance: p.groupClassCredits ?? 0 });
  return NextResponse.json({ user: toUser(updated), profile: toProfile(updated) });
});

/** DELETE — permanently remove one of the coach's clients and their chat history. */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const me = await requireUser(["OWNER", "COACH"]);
  const { id } = await ctx.params;
  const row = await loadClientFor(me, id);
  if (!row) throw notFound("Client not found.");
  const d = await db();
  await d.delete(messages).where(eq(messages.thread, `c:${id}`));
  await purgeClientGroups(id);
  await d.delete(bookings).where(eq(bookings.clientId, id));
  await purgeClientTraining(id);
  await d.delete(users).where(and(eq(users.id, id), eq(users.coachId, me.id)));
  return NextResponse.json({ ok: true });
});
