import "server-only";
import { randomUUID } from "node:crypto";
import { count, eq, inArray, sql } from "drizzle-orm";
import { AI_FEATURES, AI_FEATURE_LABEL, type AiFeature } from "./aiLog";
import { notice, tell } from "./accountAdmin";
import { db } from "./db";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { deleteGymEverything, setGymStatus } from "./gymOrg";
import { planOverview } from "./gymPlan";
import { adminActions, aiUsageLog, gymMembers, gymOrgs, users, type UserRow } from "./schema";

/*
 * The platform owner's view of gyms and AI use. Gyms show their name, admin, code, how many coaches are linked and how much AI they
 * use. Never a client count, never a client's name.
 */

export interface GymOverviewRow {
  id: string;
  name: string;
  /** The coach account that runs the gym. */
  adminId: string;
  adminName: string;
  adminEmail: string;
  code: string;
  status: string;
  coaches: number;
  pending: number;
  aiUses: number;
  aiUses30d: number;
  createdAt: string;
  trialEndsAt: string | null;
  /** The gym's subscription: its state, monthly price in cents, whether that is a custom price, and whether it asked for one. */
  plan: { status: string; priceCents: number; custom: boolean; requested: boolean };
}

const num = (v: unknown) => Number(v ?? 0);

export async function listGyms(): Promise<GymOverviewRow[]> {
  const d = await db();
  const gyms = await d.select().from(gymOrgs).orderBy(sql`${gymOrgs.createdAt} desc`);
  if (!gyms.length) return [];
  const owners = await d.select().from(users).where(inArray(users.id, gyms.map((g) => g.ownerId)));
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const members = await d.select({ gymId: gymMembers.gymId, status: gymMembers.status, n: count() }).from(gymMembers).groupBy(gymMembers.gymId, gymMembers.status);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const ai = await d
    .select({ gymId: aiUsageLog.gymId, total: sql<number>`coalesce(sum(${aiUsageLog.units}), 0)::int`, recent: sql<number>`coalesce(sum(${aiUsageLog.units}) filter (where ${aiUsageLog.at} >= ${since}), 0)::int` })
    .from(aiUsageLog)
    .where(sql`${aiUsageLog.gymId} is not null`)
    .groupBy(aiUsageLog.gymId);
  const plans = await planOverview(gyms.map((g) => g.id));
  return gyms.map((g) => {
    const o = ownerById.get(g.ownerId);
    const a = ai.find((x) => x.gymId === g.id);
    return {
      id: g.id,
      name: g.name,
      adminId: g.ownerId,
      adminName: o ? (o.name ?? o.username) : "—",
      adminEmail: o?.email ?? "",
      code: g.code,
      status: g.status,
      coaches: num(members.find((m) => m.gymId === g.id && m.status === "ACTIVE")?.n),
      pending: num(members.find((m) => m.gymId === g.id && m.status === "PENDING")?.n),
      aiUses: num(a?.total),
      aiUses30d: num(a?.recent),
      createdAt: g.createdAt.toISOString(),
      trialEndsAt: g.trialEndsAt ? g.trialEndsAt.toISOString() : null,
      plan: plans.get(g.id) ?? { status: "TRIALING", priceCents: 10000, custom: false, requested: false },
    };
  });
}

/* ---------------- AI usage ---------------- */
export interface Windows {
  today: number;
  week: number;
  month: number;
  all: number;
}
const zero = (): Windows => ({ today: 0, week: 0, month: 0, all: 0 });
const add = (a: Windows, b: Windows) => {
  a.today += b.today;
  a.week += b.week;
  a.month += b.month;
  a.all += b.all;
};

export interface AiCoachRow {
  coachId: string;
  name: string;
  email: string;
  gym: string;
  total: Windows;
  /** Of the total, the part made by the coach themselves and the part made by their clients. */
  own: number;
  byClients: number;
  byFeature: Record<AiFeature, Windows>;
  lastFeature: AiFeature | null;
  lastAt: string | null;
}

export interface AiUsageReport {
  rows: AiCoachRow[];
  gyms: { id: string; name: string; total: Windows }[];
  /** Calls by people with no coach (solo accounts), all together. */
  solo: Windows;
  featureLabels: Record<AiFeature, string>;
  totals: Windows;
}

export async function aiUsageReport(filter: { gymId?: string }): Promise<AiUsageReport> {
  const d = await db();
  const now = Date.now();
  // "Today" starts at midnight in Singapore (UTC+8), like the app's daily limits.
  const sgNow = new Date(now + 8 * 3_600_000);
  const todayStart = new Date(Date.UTC(sgNow.getUTCFullYear(), sgNow.getUTCMonth(), sgNow.getUTCDate()) - 8 * 3_600_000);
  const weekStart = new Date(now - 7 * 86_400_000);
  const monthStart = new Date(now - 30 * 86_400_000);

  const staff = await d.select().from(users).where(inArray(users.role, ["COACH", "OWNER"]));
  const members = await d.select().from(gymMembers).where(eq(gymMembers.status, "ACTIVE"));
  const gyms = await d.select().from(gymOrgs);
  const gymName = new Map(gyms.map((g) => [g.id, g.name]));
  const gymOfCoach = new Map(members.map((m) => [m.userId, m.gymId]));

  const sums = await d
    .select({
      coachId: aiUsageLog.coachId,
      gymId: aiUsageLog.gymId,
      feature: aiUsageLog.feature,
      own: sql<boolean>`(${aiUsageLog.userId} = ${aiUsageLog.coachId})`,
      today: sql<number>`coalesce(sum(${aiUsageLog.units}) filter (where ${aiUsageLog.at} >= ${todayStart}), 0)::int`,
      week: sql<number>`coalesce(sum(${aiUsageLog.units}) filter (where ${aiUsageLog.at} >= ${weekStart}), 0)::int`,
      month: sql<number>`coalesce(sum(${aiUsageLog.units}) filter (where ${aiUsageLog.at} >= ${monthStart}), 0)::int`,
      all: sql<number>`coalesce(sum(${aiUsageLog.units}), 0)::int`,
      last: sql<Date>`max(${aiUsageLog.at})`,
    })
    .from(aiUsageLog)
    .groupBy(aiUsageLog.coachId, aiUsageLog.gymId, aiUsageLog.feature, sql`(${aiUsageLog.userId} = ${aiUsageLog.coachId})`);

  const feat = (f: string): AiFeature => ((AI_FEATURES as readonly string[]).includes(f) ? (f as AiFeature) : "other");
  const rows: AiCoachRow[] = staff.map((s) => {
    const byFeature = Object.fromEntries(AI_FEATURES.map((f) => [f, zero()])) as Record<AiFeature, Windows>;
    const total = zero();
    let own = 0, byClients = 0;
    let lastAt: Date | null = null, lastFeature: AiFeature | null = null;
    for (const r of sums.filter((x) => x.coachId === s.id)) {
      const w: Windows = { today: num(r.today), week: num(r.week), month: num(r.month), all: num(r.all) };
      add(byFeature[feat(r.feature)], w);
      add(total, w);
      if (r.own) own += w.all;
      else byClients += w.all;
      const at = r.last ? new Date(r.last) : null;
      if (at && (!lastAt || at > lastAt)) {
        lastAt = at;
        lastFeature = feat(r.feature);
      }
    }
    const gid = gymOfCoach.get(s.id);
    return { coachId: s.id, name: s.name ?? s.username, email: s.email ?? "", gym: gid ? (gymName.get(gid) ?? "Gym") : "Independent", total, own, byClients, byFeature, lastFeature, lastAt: lastAt ? lastAt.toISOString() : null };
  });

  const gymRows = gyms.map((g) => {
    const t = zero();
    for (const r of sums.filter((x) => x.gymId === g.id)) add(t, { today: num(r.today), week: num(r.week), month: num(r.month), all: num(r.all) });
    return { id: g.id, name: g.name, total: t };
  });
  const solo = zero();
  for (const r of sums.filter((x) => !x.coachId)) add(solo, { today: num(r.today), week: num(r.week), month: num(r.month), all: num(r.all) });
  const totals = zero();
  for (const r of sums) add(totals, { today: num(r.today), week: num(r.week), month: num(r.month), all: num(r.all) });

  const filtered = filter.gymId ? rows.filter((r) => gymOfCoach.get(r.coachId) === filter.gymId) : rows;
  filtered.sort((a, b) => b.total.all - a.total.all || a.name.localeCompare(b.name));
  return { rows: filtered, gyms: gymRows.sort((a, b) => b.total.all - a.total.all), solo, featureLabels: AI_FEATURE_LABEL, totals };
}

/* ---------------- Switching a gym off or deleting it ---------------- */
export type GymAction = "disable" | "enable" | "delete";

export async function applyGymAction(actor: UserRow, gymId: string, action: GymAction, opts: { reason?: string; confirmName?: string }): Promise<{ email: string }> {
  const d = await db();
  const [gym] = await d.select().from(gymOrgs).where(eq(gymOrgs.id, gymId)).limit(1);
  if (!gym) throw notFound("That gym no longer exists.");
  const [owner] = await d.select().from(users).where(eq(users.id, gym.ownerId)).limit(1);
  if (owner && owner.id === actor.id) throw forbidden("You can't do that to your own gym.");
  const reason = (opts.reason ?? "").trim().slice(0, 300);
  const first = (owner?.name ?? owner?.username ?? "there").split(/\s+/)[0];
  const to = owner?.email ?? "";
  let mailStatus = "skipped";

  if (action === "disable") {
    if (gym.status === "DISABLED") throw conflict("That gym is already switched off.");
    await setGymStatus(gym.id, "DISABLED");
    if (to) mailStatus = (await tell(to, notice({ subject: `${gym.name} has been switched off on CoachFlow`, title: "Your gym has been switched off", lines: [`Hi ${first}, an administrator has switched off ${gym.name} on CoachFlow. The gym tools are unavailable for now. Your account and your coaches' accounts still work, and nothing has been deleted.`], reason }))).status;
  } else if (action === "enable") {
    if (gym.status !== "DISABLED") throw conflict("That gym isn't switched off.");
    await setGymStatus(gym.id, "ACTIVE");
    if (to) mailStatus = (await tell(to, notice({ subject: `${gym.name} is back on CoachFlow`, title: "Your gym is back on", lines: [`Hi ${first}, ${gym.name} has been switched back on. The gym tools work again.`], reason }))).status;
  } else if (action === "delete") {
    if (!opts.confirmName || opts.confirmName.trim().toLowerCase() !== gym.name.toLowerCase()) throw badRequest("Type the gym's name exactly to confirm the deletion.");
    await deleteGymEverything(gym.id);
    if (to) mailStatus = (await tell(to, notice({ subject: `${gym.name} has been deleted on CoachFlow`, title: "Your gym has been deleted", lines: [`Hi ${first}, ${gym.name} has been deleted by an administrator. Its coaches keep their own accounts and clients, and now work independently.`], reason }))).status;
  } else throw badRequest("Unknown action.");

  await d.insert(adminActions).values({ id: `aa_${randomUUID()}`, actorId: actor.id, targetId: gym.id, targetLabel: `${gym.name} (gym)`, action: `gym_${action}`, reason: reason || null });
  return { email: mailStatus };
}

