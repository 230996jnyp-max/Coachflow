import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { ALL_PERMS, STARTER_ROLES, cleanGymCode, cleanPerms, type GymInfo, type GymPerm, type PublicGym } from "@/lib/gymPerms";
import { SUPPORT_EMAIL } from "@/lib/support";
import { cleanSports } from "@/lib/sports";
import { trialDaysLeft, trialOver, TRIAL_DAYS } from "@/lib/signupRules";
import { db } from "./db";
import { badRequest, conflict, email as parseEmail, forbidden, notFound, str } from "./http";
import { escapeHtml, layout, sendMail } from "./mail";
import { notify } from "./groups";
import { billingEnforced } from "./billing";
import { coverCoach, gymBlocked } from "./gymPlan";
import { hit } from "./rateLimit";
import {
  coachSettings,
  gymAudit,
  gymBranches,
  gymInvites,
  gymMembers,
  gymMoves,
  gymOrgs,
  gymRoles,
  gyms,
  userMedia,
  users,
  type UserRow,
} from "./schema";

/*
 * A gym is run by a coach who owns it (a normal coach account). Everyone else joins with the gym's 6-digit code (the gym approves them)
 * or through an emailed invitation (no waiting). What each person may do comes from their role, which the owner designs.
 */

export type GymRow = typeof gymOrgs.$inferSelect;
export type RoleRow = typeof gymRoles.$inferSelect;
export type MemberRow = typeof gymMembers.$inferSelect;
export type BranchRow = typeof gymBranches.$inferSelect;

const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const parseList = (v: string | null | undefined): string[] => {
  try {
    const x = JSON.parse(v ?? "[]");
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
};
const nameOf = (u: UserRow) => u.name ?? u.username;

export async function audit(gymId: string, actorId: string, action: string, detail = ""): Promise<void> {
  try {
    const d = await db();
    await d.insert(gymAudit).values({ id: newId("ga"), gymId, actorId, action, detail: detail.slice(0, 300) });
  } catch (e) {
    console.error("gym audit failed", e);
  }
}

/** A fresh 6-digit gym code that no gym uses. */
export async function randomGymCode(): Promise<string> {
  const d = await db();
  for (let i = 0; i < 40; i++) {
    const code = String(randomInt(100000, 1000000));
    const hit = await d.select({ id: gymOrgs.id }).from(gymOrgs).where(eq(gymOrgs.code, code)).limit(1);
    if (hit.length === 0) return code;
  }
  throw new Error("Could not make a gym code.");
}

/* ---------------- Who am I in a gym ---------------- */
export interface Membership {
  gym: GymRow;
  member: MemberRow;
  role: RoleRow;
  perms: GymPerm[];
  isOwner: boolean;
}

/** The person's gym membership (waiting or active), or null. The owner has every permission whatever their role says. */
export async function membershipOf(userId: string): Promise<Membership | null> {
  const d = await db();
  const [m] = await d.select().from(gymMembers).where(eq(gymMembers.userId, userId)).limit(1);
  if (!m) return null;
  const [gym] = await d.select().from(gymOrgs).where(eq(gymOrgs.id, m.gymId)).limit(1);
  const [role] = await d.select().from(gymRoles).where(eq(gymRoles.id, m.roleId)).limit(1);
  if (!gym || !role) return null;
  const isOwner = gym.ownerId === userId;
  const perms = m.status !== "ACTIVE" ? [] : isOwner ? [...ALL_PERMS] : cleanPerms(parseList(role.perms));
  return { gym, member: m, role, perms, isOwner };
}

/** Throws unless the person has this permission in a gym that is switched on. */
export async function requirePerm(me: UserRow, perm: GymPerm): Promise<Membership> {
  const m = await membershipOf(me.id);
  if (!m || m.member.status !== "ACTIVE" || m.gym.status !== "ACTIVE" || !m.perms.includes(perm)) throw forbidden("Your gym role doesn't allow that.");
  return m;
}

/** Throws unless the person has any gym permission (the portal opens for them). */
export async function requirePortal(me: UserRow): Promise<Membership> {
  const m = await membershipOf(me.id);
  if (!m || m.member.status !== "ACTIVE" || m.gym.status !== "ACTIVE" || m.perms.length === 0) throw forbidden("You don't have access to a gym portal.");
  return m;
}

/** What the viewer's own record says about their gym (their role, permissions and the gym's free month). */
export async function gymInfoFor(userId: string): Promise<GymInfo | undefined> {
  const m = await membershipOf(userId);
  if (!m) return undefined;
  const t = m.gym.trialEndsAt;
  return {
    id: m.gym.id,
    name: m.gym.name,
    status: m.member.status === "PENDING" ? "PENDING" : m.gym.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    roleName: m.role.name,
    perms: m.perms,
    isOwner: m.isOwner,
    logoV: m.gym.logoV,
    bannerV: m.gym.bannerV,
    theme: m.gym.theme,
    ...(t ? { trial: { endsAt: t.toISOString(), daysLeft: trialDaysLeft(t) ?? 0, expired: trialOver(t), enforced: billingEnforced() } } : {}),
  };
}

/** The gym a coach belongs to, as their clients may see it (name, logo, banner). */
export async function publicGymOf(coachId: string): Promise<PublicGym | undefined> {
  const d = await db();
  const [row] = await d
    .select({ id: gymOrgs.id, name: gymOrgs.name, logoV: gymOrgs.logoV, bannerV: gymOrgs.bannerV })
    .from(gymMembers)
    .innerJoin(gymOrgs, eq(gymOrgs.id, gymMembers.gymId))
    .where(and(eq(gymMembers.userId, coachId), eq(gymMembers.status, "ACTIVE"), eq(gymOrgs.status, "ACTIVE")))
    .limit(1);
  return row ?? undefined;
}

/** Everyone in the gym who has `perm` (the owner always does). Used to tell the right people about join requests. */
export async function peopleWith(gymId: string, perm: GymPerm): Promise<string[]> {
  const d = await db();
  const [gym] = await d.select().from(gymOrgs).where(eq(gymOrgs.id, gymId)).limit(1);
  if (!gym) return [];
  const rows = await d.select({ userId: gymMembers.userId, perms: gymRoles.perms }).from(gymMembers).innerJoin(gymRoles, eq(gymRoles.id, gymMembers.roleId)).where(and(eq(gymMembers.gymId, gymId), eq(gymMembers.status, "ACTIVE")));
  const ids = rows.filter((r) => r.userId === gym.ownerId || cleanPerms(parseList(r.perms)).includes(perm)).map((r) => r.userId);
  return [...new Set([gym.ownerId, ...ids])];
}

/** Gym trial for the free month; the platform stops for the gym's coaches and admins once it is over and payments are enforced. */
export async function gymTrialBlocks(userId: string): Promise<boolean | null> {
  const m = await membershipOf(userId);
  if (!m || m.member.status !== "ACTIVE") return null;
  // The gym's own plan decides (free month, subscription, grace after a failed payment); only once BILLING_ENFORCED=1.
  return gymBlocked(m.gym);
}

/* ---------------- Creating a gym ---------------- */
export async function createGym(owner: UserRow, name: string): Promise<GymRow> {
  const d = await db();
  const gymId = newId("gym");
  const code = await randomGymCode();
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
  await d.insert(gymOrgs).values({ id: gymId, name, code, ownerId: owner.id, trialEndsAt });
  let ownerRoleId = "";
  for (const r of STARTER_ROLES) {
    const id = newId("gr");
    if (r.locked) ownerRoleId = id;
    await d.insert(gymRoles).values({ id, gymId, name: r.name, perms: JSON.stringify(r.perms), locked: !!r.locked });
  }
  await d.insert(gymMembers).values({ gymId, userId: owner.id, roleId: ownerRoleId, status: "ACTIVE", joinedAt: new Date() });
  await audit(gymId, owner.id, "gym_created", name);
  const [gym] = await d.select().from(gymOrgs).where(eq(gymOrgs.id, gymId)).limit(1);
  return gym;
}

/* ---------------- Defaults for a coach who links ---------------- */
/** Gives a coach the gym's theme, niches and locations. Done once when they link (and on request); the coach can change everything afterwards. */
export async function applyDefaults(coachId: string, gym: GymRow): Promise<void> {
  const d = await db();
  if (gym.theme === "black" || gym.theme === "white" || gym.theme === "navy") await d.update(users).set({ theme: gym.theme, updatedAt: new Date() }).where(eq(users.id, coachId));

  const niches = cleanSports(parseList(gym.niches));
  if (niches.length) {
    const [cs] = await d.select({ specialties: coachSettings.specialties }).from(coachSettings).where(eq(coachSettings.coachId, coachId)).limit(1);
    const have = cs ? cleanSports(parseList(cs.specialties)) : [];
    const merged = [...have, ...niches.filter((n) => !have.includes(n))];
    if (!cs) await d.insert(coachSettings).values({ coachId, specialties: JSON.stringify(merged) }).onConflictDoNothing();
    else if (merged.length !== have.length) await d.update(coachSettings).set({ specialties: JSON.stringify(merged) }).where(eq(coachSettings.coachId, coachId));
  }

  const branches = await d.select().from(gymBranches).where(eq(gymBranches.gymId, gym.id));
  if (branches.length) {
    const mine = await d.select({ name: gyms.name }).from(gyms).where(eq(gyms.coachId, coachId));
    const has = new Set(mine.map((g) => g.name.toLowerCase()));
    for (const b of branches) if (!has.has(b.name.toLowerCase())) await d.insert(gyms).values({ id: newId("g"), coachId, name: b.name, address: b.address, active: true });
  }
}

/** The "apply to everyone" button: hands the gym's current defaults to every active coach. */
export async function applyDefaultsToAll(gymId: string): Promise<number> {
  const d = await db();
  const [gym] = await d.select().from(gymOrgs).where(eq(gymOrgs.id, gymId)).limit(1);
  if (!gym) throw notFound("That gym no longer exists.");
  const members = await d.select({ userId: gymMembers.userId }).from(gymMembers).where(and(eq(gymMembers.gymId, gymId), eq(gymMembers.status, "ACTIVE")));
  for (const m of members) await applyDefaults(m.userId, gym);
  return members.length;
}

/* ---------------- Joining and leaving ---------------- */
/** Public: what a typed gym code points at (name and logo only). */
export async function lookupGym(code: unknown): Promise<{ name: string; logoV: number; id: string } | null> {
  const clean = cleanGymCode(code);
  if (!clean) return null;
  const d = await db();
  const [g] = await d.select().from(gymOrgs).where(and(eq(gymOrgs.code, clean), eq(gymOrgs.status, "ACTIVE"))).limit(1);
  return g ? { name: g.name, logoV: g.logoV, id: g.id } : null;
}

export async function joinWithCode(user: UserRow, code: unknown): Promise<{ status: "ACTIVE" | "PENDING"; gymName: string }> {
  if (user.role !== "COACH") throw forbidden("Only a coach account can join a gym.");
  await hit(`gymjoin:${user.id}`, 10, 3_600_000, "Too many tries. Please wait a while and try again.");
  const clean = cleanGymCode(code);
  if (!clean) throw badRequest("A gym code is six digits.");
  const d = await db();
  const [gym] = await d.select().from(gymOrgs).where(and(eq(gymOrgs.code, clean), eq(gymOrgs.status, "ACTIVE"))).limit(1);
  if (!gym) throw notFound("We couldn't find a gym with that code.");
  if (await membershipOf(user.id)) throw conflict("You are already linked to a gym. Leave it first to join another.");

  const roles = await d.select().from(gymRoles).where(eq(gymRoles.gymId, gym.id)).orderBy(asc(gymRoles.createdAt));
  const defaultRole = roles.find((r) => r.name === "Coach") ?? roles.find((r) => !r.locked) ?? roles[0];
  const addr = (user.email ?? "").toLowerCase();
  const [invite] = addr ? await d.select().from(gymInvites).where(and(eq(gymInvites.gymId, gym.id), eq(gymInvites.email, addr))).limit(1) : [];
  const inviteRole = invite ? roles.find((r) => r.id === invite.roleId) : undefined;

  if (invite && inviteRole) {
    await d.insert(gymMembers).values({ gymId: gym.id, userId: user.id, roleId: inviteRole.id, status: "ACTIVE", joinedAt: new Date() });
    await d.delete(gymInvites).where(eq(gymInvites.id, invite.id));
    await applyDefaults(user.id, gym);
    void coverCoach(user.id, gym); // a paying gym covers them: their own subscription stops renewing
    await audit(gym.id, user.id, "joined", `${nameOf(user)} joined by invitation as ${inviteRole.name}`);
    await notify(await peopleWith(gym.id, "coaches.manage"), "gym_joined", { title: "A coach joined your gym", body: `${nameOf(user)} joined ${gym.name} as ${inviteRole.name}.`, link: "/gym-admin" }, { email: false });
    return { status: "ACTIVE", gymName: gym.name };
  }
  await d.insert(gymMembers).values({ gymId: gym.id, userId: user.id, roleId: defaultRole.id, status: "PENDING" });
  await audit(gym.id, user.id, "join_requested", `${nameOf(user)} asked to join`);
  await notify(await peopleWith(gym.id, "coaches.manage"), "gym_request", { title: "A coach wants to join your gym", body: `${nameOf(user)} used your gym code. Approve or decline on the Team tab.`, link: "/gym-admin" });
  return { status: "PENDING", gymName: gym.name };
}

/** Leave the gym (or withdraw a request). The owner can't leave; their gym goes with the platform owner or a delete. */
export async function leaveGym(user: UserRow): Promise<void> {
  const m = await membershipOf(user.id);
  if (!m) return;
  if (m.isOwner) throw conflict("You own this gym, so you can't leave it.");
  const d = await db();
  await d.delete(gymMembers).where(eq(gymMembers.userId, user.id));
  await audit(m.gym.id, user.id, m.member.status === "ACTIVE" ? "left" : "request_withdrawn", nameOf(user));
  if (m.member.status === "ACTIVE") await notify(await peopleWith(m.gym.id, "coaches.manage"), "gym_left", { title: "A coach left your gym", body: `${nameOf(user)} left ${m.gym.name}. They keep their own clients.`, link: "/gym-admin" }, { email: false });
}

/* ---------------- Team ---------------- */
export interface TeamPerson {
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  status: "ACTIVE" | "PENDING";
  isOwner: boolean;
  niches: string[];
  branchId: string | null;
  rateCents: number | null;
  joinedAt: string | null;
  requestedAt: string;
  lastLoginAt: string | null;
}

export async function listTeam(gymId: string): Promise<{ people: TeamPerson[]; invites: { id: string; email: string; roleName: string; createdAt: string }[] }> {
  const d = await db();
  const [gym] = await d.select().from(gymOrgs).where(eq(gymOrgs.id, gymId)).limit(1);
  const rows = await d.select().from(gymMembers).where(eq(gymMembers.gymId, gymId));
  const roles = await d.select().from(gymRoles).where(eq(gymRoles.gymId, gymId));
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const us = rows.length ? await d.select().from(users).where(inArray(users.id, rows.map((r) => r.userId))) : [];
  const byId = new Map(us.map((u) => [u.id, u]));
  const settings = rows.length ? await d.select().from(coachSettings).where(inArray(coachSettings.coachId, rows.map((r) => r.userId))) : [];
  const nicheOf = new Map(settings.map((s) => [s.coachId, cleanSports(parseList(s.specialties))]));
  const people: TeamPerson[] = rows
    .map((m) => {
      const u = byId.get(m.userId);
      return {
        userId: m.userId,
        name: u ? nameOf(u) : "Former member",
        email: u?.email ?? "",
        roleId: m.roleId,
        roleName: roleName.get(m.roleId) ?? "—",
        status: (m.status === "ACTIVE" ? "ACTIVE" : "PENDING") as "ACTIVE" | "PENDING",
        isOwner: gym?.ownerId === m.userId,
        niches: nicheOf.get(m.userId) ?? [],
        branchId: m.branchId,
        rateCents: m.rateCents,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        requestedAt: m.requestedAt.toISOString(),
        lastLoginAt: u?.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      };
    })
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name));
  const inv = await d.select().from(gymInvites).where(eq(gymInvites.gymId, gymId)).orderBy(desc(gymInvites.createdAt));
  return { people, invites: inv.map((i) => ({ id: i.id, email: i.email, roleName: roleName.get(i.roleId) ?? "—", createdAt: i.createdAt.toISOString() })) };
}

async function memberOf(gymId: string, userId: string): Promise<{ member: MemberRow; user: UserRow }> {
  const d = await db();
  const [member] = await d.select().from(gymMembers).where(and(eq(gymMembers.gymId, gymId), eq(gymMembers.userId, userId))).limit(1);
  const [user] = await d.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!member || !user) throw notFound("That person isn't in your gym.");
  return { member, user };
}

async function roleIn(gymId: string, roleId: unknown): Promise<RoleRow> {
  const d = await db();
  const [r] = await d.select().from(gymRoles).where(and(eq(gymRoles.gymId, gymId), eq(gymRoles.id, String(roleId ?? "")))).limit(1);
  if (!r) throw badRequest("Choose a role from your gym.");
  return r;
}

export async function approveMember(m: Membership, actor: UserRow, userId: string, roleId?: unknown): Promise<void> {
  const { member, user } = await memberOf(m.gym.id, userId);
  if (member.status === "ACTIVE") throw conflict("That person is already in the gym.");
  const role = roleId ? await roleIn(m.gym.id, roleId) : await roleIn(m.gym.id, member.roleId);
  if (role.locked) throw badRequest("Choose another role. The owner role can't be given out.");
  const d = await db();
  await d.update(gymMembers).set({ status: "ACTIVE", roleId: role.id, joinedAt: new Date() }).where(and(eq(gymMembers.gymId, m.gym.id), eq(gymMembers.userId, userId)));
  await applyDefaults(userId, m.gym);
  void coverCoach(userId, m.gym);
  await audit(m.gym.id, actor.id, "approved", `${nameOf(user)} as ${role.name}`);
  await notify([userId], "gym_approved", { title: `Welcome to ${m.gym.name}`, body: `${m.gym.name} approved you as ${role.name}. The gym's theme, niches and locations were added to your account; you can change any of them.`, link: "/settings/coaching" });
}

export async function declineMember(m: Membership, actor: UserRow, userId: string): Promise<void> {
  const { member, user } = await memberOf(m.gym.id, userId);
  if (member.status === "ACTIVE") throw conflict("Use Remove for someone who is already in the gym.");
  const d = await db();
  await d.delete(gymMembers).where(and(eq(gymMembers.gymId, m.gym.id), eq(gymMembers.userId, userId)));
  await audit(m.gym.id, actor.id, "declined", nameOf(user));
  await notify([userId], "gym_declined", { title: "Gym request", body: `${m.gym.name} couldn't take you on right now. You can keep coaching on your own.`, link: "/settings/coaching" });
}

export async function removeMember(m: Membership, actor: UserRow, userId: string): Promise<void> {
  if (userId === m.gym.ownerId) throw forbidden("The owner can't be removed.");
  const { user } = await memberOf(m.gym.id, userId);
  const d = await db();
  await d.delete(gymMembers).where(and(eq(gymMembers.gymId, m.gym.id), eq(gymMembers.userId, userId)));
  await audit(m.gym.id, actor.id, "removed", nameOf(user));
  await notify([userId], "gym_removed", { title: "You were removed from a gym", body: `You are no longer part of ${m.gym.name}. Your account and your own clients are unchanged.`, link: "/settings/coaching" });
}

export async function setMemberRole(m: Membership, actor: UserRow, userId: string, roleId: unknown): Promise<void> {
  if (userId === m.gym.ownerId) throw forbidden("The owner's role can't be changed.");
  const { member, user } = await memberOf(m.gym.id, userId);
  const role = await roleIn(m.gym.id, roleId);
  if (role.locked) throw badRequest("The owner role can't be given out.");
  const d = await db();
  await d.update(gymMembers).set({ roleId: role.id }).where(and(eq(gymMembers.gymId, m.gym.id), eq(gymMembers.userId, userId)));
  await audit(m.gym.id, actor.id, "role_changed", `${nameOf(user)} is now ${role.name}${member.status === "PENDING" ? " (not yet approved)" : ""}`);
}

export async function setMemberDetails(m: Membership, actor: UserRow, userId: string, body: { rate?: unknown; branchId?: unknown }): Promise<void> {
  const { user } = await memberOf(m.gym.id, userId);
  const d = await db();
  const set: Partial<MemberRow> = {};
  if ("rate" in body) {
    if (body.rate === null || body.rate === "") set.rateCents = null;
    else {
      const n = Number(body.rate);
      if (!Number.isFinite(n) || n < 0 || n > 100000) throw badRequest("An hourly rate is a number from 0 to 100000.");
      set.rateCents = Math.round(n * 100);
    }
  }
  if ("branchId" in body) {
    if (!body.branchId) set.branchId = null;
    else {
      const [b] = await d.select().from(gymBranches).where(and(eq(gymBranches.gymId, m.gym.id), eq(gymBranches.id, String(body.branchId)))).limit(1);
      if (!b) throw badRequest("That branch isn't in your gym.");
      set.branchId = b.id;
    }
  }
  if (Object.keys(set).length === 0) throw badRequest("Nothing to change.");
  await d.update(gymMembers).set(set).where(and(eq(gymMembers.gymId, m.gym.id), eq(gymMembers.userId, userId)));
  await audit(m.gym.id, actor.id, "member_updated", nameOf(user));
}

export async function inviteByEmail(m: Membership, actor: UserRow, emailRaw: unknown, roleId: unknown, origin: string): Promise<{ status: string }> {
  const address = parseEmail(emailRaw, "Email");
  const role = await roleIn(m.gym.id, roleId);
  if (role.locked) throw badRequest("The owner role can't be given out.");
  const d = await db();
  const [existing] = await d.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${address}`).limit(1);
  if (existing) {
    const [already] = await d.select().from(gymMembers).where(and(eq(gymMembers.gymId, m.gym.id), eq(gymMembers.userId, existing.id))).limit(1);
    if (already) throw conflict("That person is already in your gym.");
  }
  await d.delete(gymInvites).where(and(eq(gymInvites.gymId, m.gym.id), eq(gymInvites.email, address)));
  await d.insert(gymInvites).values({ id: newId("gi"), gymId: m.gym.id, email: address, roleId: role.id });
  await audit(m.gym.id, actor.id, "invited", `${address} as ${role.name}`);
  const link = `${origin}/signup?role=coach&gym=${m.gym.code}`;
  const text = `${m.gym.name} has invited you to join them on CoachFlow as ${role.name}.\n\nNew to CoachFlow? Create your account here (the gym code is filled in for you):\n${link}\n\nAlready have an account? Open Settings, then Coaching, and enter the gym code ${m.gym.code}.\n\nYou join straight away, no waiting for approval. Questions? ${SUPPORT_EMAIL}`;
  const html = layout(`${m.gym.name} invited you`, `<p style="margin:0 0 12px;color:#E8ECF4;line-height:1.5;">${escapeHtml(m.gym.name)} has invited you to join them on CoachFlow as <strong>${escapeHtml(role.name)}</strong>.</p><p style="margin:0 0 12px;color:#E8ECF4;line-height:1.5;">Already have an account? Open Settings, then Coaching, and enter the gym code <strong>${m.gym.code}</strong>.</p><p style="margin:12px 0 0;color:#8892A6;font-size:13px;">You join straight away, no waiting for approval.</p>`, { label: "Create my account", href: link });
  const res = await sendMail({ to: address, subject: `${m.gym.name} invited you to CoachFlow`, text, html, from: `"CoachFlow" <${process.env.SMTP_USER || SUPPORT_EMAIL}>`, replyTo: SUPPORT_EMAIL });
  return { status: res.status };
}

export async function cancelInvite(m: Membership, actor: UserRow, inviteId: string): Promise<void> {
  const d = await db();
  await d.delete(gymInvites).where(and(eq(gymInvites.gymId, m.gym.id), eq(gymInvites.id, inviteId)));
  await audit(m.gym.id, actor.id, "invite_cancelled", "");
}

export async function regenerateCode(m: Membership, actor: UserRow): Promise<string> {
  const code = await randomGymCode();
  const d = await db();
  await d.update(gymOrgs).set({ code }).where(eq(gymOrgs.id, m.gym.id));
  await audit(m.gym.id, actor.id, "code_regenerated", "");
  return code;
}

/* ---------------- Roles ---------------- */
export async function listRoles(gymId: string): Promise<{ id: string; name: string; perms: GymPerm[]; locked: boolean; members: number }[]> {
  const d = await db();
  const roles = await d.select().from(gymRoles).where(eq(gymRoles.gymId, gymId)).orderBy(asc(gymRoles.createdAt));
  const members = await d.select({ roleId: gymMembers.roleId }).from(gymMembers).where(eq(gymMembers.gymId, gymId));
  return roles.map((r) => ({ id: r.id, name: r.name, perms: r.locked ? [...ALL_PERMS] : cleanPerms(parseList(r.perms)), locked: r.locked, members: members.filter((x) => x.roleId === r.id).length }));
}

export async function createRole(m: Membership, actor: UserRow, name: unknown, perms: unknown): Promise<string> {
  const clean = str(name, "Role name", { min: 2, max: 40 });
  const d = await db();
  const dup = (await d.select({ id: gymRoles.id }).from(gymRoles).where(and(eq(gymRoles.gymId, m.gym.id), sql`lower(${gymRoles.name}) = ${clean.toLowerCase()}`))).length > 0;
  if (dup) throw conflict("You already have a role with that name.");
  const id = newId("gr");
  await d.insert(gymRoles).values({ id, gymId: m.gym.id, name: clean, perms: JSON.stringify(cleanPerms(perms)) });
  await audit(m.gym.id, actor.id, "role_created", clean);
  return id;
}

export async function updateRole(m: Membership, actor: UserRow, roleId: string, body: { name?: unknown; perms?: unknown }): Promise<void> {
  const role = await roleIn(m.gym.id, roleId);
  if (role.locked) throw forbidden("The owner role can't be edited.");
  const d = await db();
  const set: Partial<RoleRow> = {};
  if (body.name !== undefined) set.name = str(body.name, "Role name", { min: 2, max: 40 });
  if (body.perms !== undefined) set.perms = JSON.stringify(cleanPerms(body.perms));
  if (Object.keys(set).length === 0) throw badRequest("Nothing to change.");
  await d.update(gymRoles).set(set).where(eq(gymRoles.id, role.id));
  await audit(m.gym.id, actor.id, "role_updated", set.name ?? role.name);
}

export async function deleteRole(m: Membership, actor: UserRow, roleId: string): Promise<void> {
  const role = await roleIn(m.gym.id, roleId);
  if (role.locked) throw forbidden("The owner role can't be deleted.");
  const d = await db();
  const using = await d.select({ userId: gymMembers.userId }).from(gymMembers).where(eq(gymMembers.roleId, role.id));
  if (using.length) throw conflict(`${using.length} ${using.length === 1 ? "person has" : "people have"} this role. Give them another role first.`);
  const inv = await d.select({ id: gymInvites.id }).from(gymInvites).where(eq(gymInvites.roleId, role.id));
  if (inv.length) throw conflict("An open invitation uses this role. Cancel it first.");
  await d.delete(gymRoles).where(eq(gymRoles.id, role.id));
  await audit(m.gym.id, actor.id, "role_deleted", role.name);
}

/* ---------------- Settings, branches, branding ---------------- */
export interface GymSettings {
  id: string;
  name: string;
  code: string;
  theme: string | null;
  niches: string[];
  countNoShows: boolean;
  logoV: number;
  bannerV: number;
  status: string;
  trial?: GymInfo["trial"];
  branches: { id: string; name: string; address: string }[];
}

export async function gymSettings(gym: GymRow): Promise<GymSettings> {
  const d = await db();
  const branches = await d.select().from(gymBranches).where(eq(gymBranches.gymId, gym.id)).orderBy(asc(gymBranches.name));
  const t = gym.trialEndsAt;
  return {
    id: gym.id,
    name: gym.name,
    code: gym.code,
    theme: gym.theme,
    niches: cleanSports(parseList(gym.niches)),
    countNoShows: gym.countNoShows,
    logoV: gym.logoV,
    bannerV: gym.bannerV,
    status: gym.status,
    ...(t ? { trial: { endsAt: t.toISOString(), daysLeft: trialDaysLeft(t) ?? 0, expired: trialOver(t), enforced: billingEnforced() } } : {}),
    branches: branches.map((b) => ({ id: b.id, name: b.name, address: b.address })),
  };
}

export async function updateGymSettings(m: Membership, actor: UserRow, body: Record<string, unknown>): Promise<void> {
  const d = await db();
  const set: Partial<GymRow> = {};
  if ("name" in body) set.name = str(body.name, "Gym name", { min: 2, max: 80 });
  if ("theme" in body) {
    if (body.theme === null || body.theme === "") set.theme = null;
    else if (body.theme === "black" || body.theme === "white" || body.theme === "navy") set.theme = body.theme;
    else throw badRequest("Unknown theme.");
  }
  if ("niches" in body) {
    if (!Array.isArray(body.niches)) throw badRequest("Niches must be a list.");
    set.niches = JSON.stringify(cleanSports(body.niches).slice(0, 8));
  }
  if ("countNoShows" in body) {
    if (typeof body.countNoShows !== "boolean") throw badRequest("Count no-shows must be on or off.");
    set.countNoShows = body.countNoShows;
  }
  if (Object.keys(set).length === 0) throw badRequest("Nothing to change.");
  await d.update(gymOrgs).set(set).where(eq(gymOrgs.id, m.gym.id));
  await audit(m.gym.id, actor.id, "settings_changed", Object.keys(set).join(", "));
}

export async function addBranch(m: Membership, actor: UserRow, name: unknown, address: unknown): Promise<string> {
  const n = str(name, "Branch name", { min: 2, max: 80 });
  const a = str(address, "Address", { optional: true, max: 160 });
  const d = await db();
  const id = newId("gb");
  await d.insert(gymBranches).values({ id, gymId: m.gym.id, name: n, address: a });
  await audit(m.gym.id, actor.id, "branch_added", n);
  return id;
}

export async function updateBranch(m: Membership, actor: UserRow, id: string, body: { name?: unknown; address?: unknown }): Promise<void> {
  const d = await db();
  const set: Partial<BranchRow> = {};
  if (body.name !== undefined) set.name = str(body.name, "Branch name", { min: 2, max: 80 });
  if (body.address !== undefined) set.address = str(body.address, "Address", { optional: true, max: 160 });
  if (Object.keys(set).length === 0) throw badRequest("Nothing to change.");
  const done = await d.update(gymBranches).set(set).where(and(eq(gymBranches.id, id), eq(gymBranches.gymId, m.gym.id))).returning({ id: gymBranches.id });
  if (!done.length) throw notFound("That branch isn't in your gym.");
  await audit(m.gym.id, actor.id, "branch_updated", set.name ?? "");
}

export async function deleteBranch(m: Membership, actor: UserRow, id: string): Promise<void> {
  const d = await db();
  const done = await d.delete(gymBranches).where(and(eq(gymBranches.id, id), eq(gymBranches.gymId, m.gym.id))).returning({ name: gymBranches.name });
  if (!done.length) throw notFound("That branch isn't in your gym.");
  await d.update(gymMembers).set({ branchId: null }).where(and(eq(gymMembers.gymId, m.gym.id), eq(gymMembers.branchId, id)));
  await audit(m.gym.id, actor.id, "branch_deleted", done[0].name);
}

export async function recentAudit(gymId: string, limit = 100) {
  const d = await db();
  const rows = await d.select().from(gymAudit).where(eq(gymAudit.gymId, gymId)).orderBy(desc(gymAudit.at)).limit(limit);
  const ids = [...new Set(rows.map((r) => r.actorId))];
  const us = ids.length ? await d.select().from(users).where(inArray(users.id, ids)) : [];
  const nm = new Map(us.map((u) => [u.id, nameOf(u)]));
  return rows.map((r) => ({ id: r.id, actor: nm.get(r.actorId) ?? "Someone", action: r.action, detail: r.detail, at: r.at.toISOString() }));
}

/* ---------------- The platform owner switching a gym off or deleting it ---------------- */
export async function setGymStatus(gymId: string, status: "ACTIVE" | "DISABLED"): Promise<void> {
  const d = await db();
  await d.update(gymOrgs).set({ status }).where(eq(gymOrgs.id, gymId));
}

/** Everything of the gym goes; its coaches become independent (their accounts, clients and the branding they were given stay). */
export async function deleteGymEverything(gymId: string): Promise<void> {
  const d = await db();
  await d.delete(gymMembers).where(eq(gymMembers.gymId, gymId));
  await d.delete(gymRoles).where(eq(gymRoles.gymId, gymId));
  await d.delete(gymBranches).where(eq(gymBranches.gymId, gymId));
  await d.delete(gymInvites).where(eq(gymInvites.gymId, gymId));
  await d.delete(gymMoves).where(eq(gymMoves.gymId, gymId));
  await d.delete(gymAudit).where(eq(gymAudit.gymId, gymId));
  await d.delete(userMedia).where(eq(userMedia.userId, gymId));
  await d.delete(gymOrgs).where(eq(gymOrgs.id, gymId));
}

