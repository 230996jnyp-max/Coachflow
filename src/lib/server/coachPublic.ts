import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { averageStars } from "@/lib/consults";
import { cleanPrefs } from "@/lib/prefs";
import { cleanSports } from "@/lib/sports";
import { openProfile, openStaffProfile, usersByIds } from "./accounts";
import { db } from "./db";
import { badRequest, notFound } from "./http";
import { listPackages, paymentState, type PackageRec } from "./payments";
import { coachPublic, coachSettings, consultBlocks, consults, gymMembers, gymOrgs, userMedia, users, type UserRow } from "./schema";

/*
 * A coach's public profile page (/coach/<username>), for sharing on Instagram or WhatsApp and for the people they meet through consults.
 * It shows only what the coach chose: a headline, about, experience, certifications, area, niches, gym name, packages and the ratings
 * from consults. Never an email, a phone number or anything about their clients. A coach can switch the page off.
 */

export interface PublicData {
  headline: string;
  about: string;
  experienceYears: number | null;
  certifications: string[];
  /** A neighbourhood or city ("Tampines", "Singapore"), never a street address. */
  area: string;
  showPackages: boolean;
}

const EMPTY: PublicData = { headline: "", about: "", experienceYears: null, certifications: [], area: "", showPackages: true };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

/** Only known fields, trimmed and capped. Anything else sent in is dropped. */
export function cleanPublic(raw: unknown): PublicData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY };
  const r = raw as Record<string, unknown>;
  const years = r.experienceYears === null || r.experienceYears === "" || r.experienceYears === undefined ? null : Number(r.experienceYears);
  if (years !== null && (!Number.isInteger(years) || years < 0 || years > 60)) throw badRequest("Years of experience should be a whole number from 0 to 60.");
  const certs = Array.isArray(r.certifications) ? [...new Set(r.certifications.map((c) => str(c, 80)).filter(Boolean))].slice(0, 10) : [];
  return {
    headline: str(r.headline, 120),
    about: typeof r.about === "string" ? r.about.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 1500) : "",
    experienceYears: years,
    certifications: certs,
    area: str(r.area, 60),
    showPackages: r.showPackages !== false,
  };
}

function parse(json: string | null | undefined): PublicData {
  try {
    return { ...EMPTY, ...cleanPublic(JSON.parse(json ?? "{}")) };
  } catch {
    return { ...EMPTY };
  }
}

async function rowOf(coachId: string) {
  const d = await db();
  const [r] = await d.select().from(coachPublic).where(eq(coachPublic.coachId, coachId)).limit(1);
  return r ?? null;
}

const isStaff = (u: Pick<UserRow, "role">) => u.role === "COACH" || u.role === "OWNER";

/** A username that is safe to put in a public address (not an email: some coaches sign in with theirs). */
const SAFE_USERNAME = /^[a-z0-9._-]{3,32}$/;

/**
 * The part after /coach/ in a coach's page address: their username, or, when the username is an email address (which must never appear
 * in a public link), "c-" and their six-digit coach code.
 */
export function publicSlug(u: Pick<UserRow, "id" | "username" | "coachCode">): string {
  if (SAFE_USERNAME.test(u.username)) return u.username;
  return u.coachCode ? `c-${u.coachCode}` : `id-${u.id.replace(/^u_/, "").slice(0, 12)}`;
}

/* ---------------- The coach's own editor ---------------- */
export interface MyPublicProfile {
  isPublic: boolean;
  takesConsults: boolean;
  data: PublicData;
  path: string;
  /** Consults pay through the coach's connected Stripe account. */
  stripeReady: boolean;
  /** The owner stopped this coach from taking consults. */
  consultsSuspended: boolean;
}

/** What the coach sees in Settings. Empty fields start from what they gave at sign-up (tagline, years) and their bio. */
export async function myPublicProfile(coach: UserRow): Promise<MyPublicProfile> {
  if (!isStaff(coach)) throw notFound();
  const row = await rowOf(coach.id);
  let data = parse(row?.data);
  if (!row) {
    let staff: { tagline?: string; experienceYears?: number } = {};
    try {
      staff = openStaffProfile(coach);
    } catch {
      /* none */
    }
    const bio = cleanPrefs(safeJson(coach.prefs)).bio ?? "";
    data = { ...data, headline: staff.tagline ?? "", experienceYears: typeof staff.experienceYears === "number" ? staff.experienceYears : null, about: bio };
  }
  const d = await db();
  const [blocked] = await d.select().from(consultBlocks).where(eq(consultBlocks.userId, coach.id)).limit(1);
  const pay = await paymentState(coach).catch(() => null);
  return { isPublic: row?.isPublic ?? true, takesConsults: !!row?.takesConsults && !blocked, data, path: `/coach/${publicSlug(coach)}`, stripeReady: !!pay?.stripeReady, consultsSuspended: !!blocked };
}

export async function saveMyPublicProfile(coach: UserRow, body: Record<string, unknown>): Promise<MyPublicProfile> {
  if (!isStaff(coach)) throw notFound();
  const prev = await rowOf(coach.id);
  const data = "data" in body ? cleanPublic(body.data) : parse(prev?.data);
  const isPublic = typeof body.isPublic === "boolean" ? body.isPublic : (prev?.isPublic ?? true);
  let takesConsults = typeof body.takesConsults === "boolean" ? body.takesConsults : (prev?.takesConsults ?? false);
  if (takesConsults && !prev?.takesConsults) {
    const d = await db();
    const [blocked] = await d.select().from(consultBlocks).where(eq(consultBlocks.userId, coach.id)).limit(1);
    if (blocked) throw badRequest("You can't take consults at the moment. Contact CoachFlow support if you think this is a mistake.");
    const pay = await paymentState(coach).catch(() => null);
    if (!pay?.stripeReady) throw badRequest("Connect your Stripe account first (Settings, Payments): that is where your share of each consult is paid.");
  }
  if (typeof body.takesConsults !== "boolean") takesConsults = prev?.takesConsults ?? false;
  const d = await db();
  const values = { coachId: coach.id, isPublic, data: JSON.stringify(data), takesConsults, updatedAt: new Date() };
  await d.insert(coachPublic).values(values).onConflictDoUpdate({ target: coachPublic.coachId, set: values });
  return myPublicProfile(coach);
}

/** A coach's name as shown publicly (never their username when that is an email). */
function displayName(u: UserRow): string {
  const n = (u.name ?? "").trim();
  return n || (SAFE_USERNAME.test(u.username) ? u.username : "CoachFlow coach");
}

function safeJson(s: string | null | undefined): unknown {
  try {
    return JSON.parse(s ?? "{}");
  } catch {
    return {};
  }
}

/* ---------------- The public page ---------------- */
export interface PublicReview {
  name: string;
  stars: number;
  text: string;
  at: string;
}

export interface PublicCoach {
  slug: string;
  name: string;
  data: PublicData;
  niches: string[];
  gym: string | null;
  avatarV: number;
  packages: PackageRec[];
  rating: { average: number | null; count: number };
  reviews: PublicReview[];
  /** For "Train with ..." (the coach code a client types at sign-up). */
  coachCode: string | null;
  takesConsults: boolean;
}

/** A coach whose page can be shown, or null (no such coach, not a coach, switched off, disabled or not yet verified). */
async function publicCoachRow(slugRaw: string): Promise<UserRow | null> {
  const slug = decodeURIComponent(slugRaw).trim().toLowerCase();
  const d = await db();
  let u: UserRow | undefined;
  if (SAFE_USERNAME.test(slug)) [u] = await d.select().from(users).where(eq(users.username, slug)).limit(1);
  // The coach-code address, only for a coach whose username can't be shown.
  if (!u && /^c-\d{6}$/.test(slug)) {
    const [byCode] = await d.select().from(users).where(eq(users.coachCode, slug.slice(2))).limit(1);
    if (byCode && !SAFE_USERNAME.test(byCode.username)) u = byCode;
  }
  if (!u && /^id-[a-z0-9-]{12}$/.test(slug)) {
    const rows = await d.select().from(users).where(and(eq(users.role, "COACH"), isNotNull(users.id)));
    u = rows.find((r) => !SAFE_USERNAME.test(r.username) && !r.coachCode && publicSlug(r) === slug);
  }
  if (!u || !isStaff(u) || !u.active || u.disabledAt || !u.emailVerified) return null;
  const row = await rowOf(u.id);
  if (row && !row.isPublic) return null;
  return u;
}

const firstName = (row: UserRow | undefined): string => {
  if (!row) return "Someone";
  try {
    const n = (row.role === "CLIENT" ? openProfile(row).name : (row.name ?? row.username)).trim();
    return n.split(/\s+/)[0] || "Someone";
  } catch {
    return "Someone";
  }
};

export async function publicCoach(username: string): Promise<PublicCoach | null> {
  const u = await publicCoachRow(username);
  if (!u) return null;
  const d = await db();
  const row = await rowOf(u.id);
  const data = row ? parse(row.data) : (await myPublicProfile(u)).data;
  const [settings] = await d.select({ specialties: coachSettings.specialties }).from(coachSettings).where(eq(coachSettings.coachId, u.id)).limit(1);
  const niches = cleanSports(safeJson(settings?.specialties ?? "[]"));
  const [gym] = await d
    .select({ name: gymOrgs.name })
    .from(gymMembers)
    .innerJoin(gymOrgs, eq(gymOrgs.id, gymMembers.gymId))
    .where(and(eq(gymMembers.userId, u.id), eq(gymMembers.status, "ACTIVE"), eq(gymOrgs.status, "ACTIVE")))
    .limit(1);
  const rated = await d
    .select({ stars: consults.stars, review: consults.review, reviewedAt: consults.reviewedAt, soloId: consults.soloId })
    .from(consults)
    .where(and(eq(consults.trainerId, u.id), isNotNull(consults.stars)))
    .orderBy(desc(consults.reviewedAt))
    .limit(200);
  const reviewers = await usersByIds([...new Set(rated.filter((r) => (r.review ?? "").trim()).slice(0, 12).map((r) => r.soloId))]);
  const byId = new Map(reviewers.map((r) => [r.id, r]));
  const reviews = rated
    .filter((r) => (r.review ?? "").trim())
    .slice(0, 12)
    .map((r) => ({ name: firstName(byId.get(r.soloId)), stars: r.stars ?? 0, text: (r.review ?? "").trim(), at: (r.reviewedAt ?? new Date()).toISOString() }));
  const [blocked] = await d.select().from(consultBlocks).where(eq(consultBlocks.userId, u.id)).limit(1);
  return {
    slug: publicSlug(u),
    name: displayName(u),
    data,
    niches,
    gym: gym?.name ?? null,
    avatarV: cleanPrefs(safeJson(u.prefs)).avatarV ?? 0,
    packages: data.showPackages ? await listPackages(u.id, true) : [],
    rating: { average: averageStars(rated.map((r) => r.stars ?? 0).filter((n) => n > 0)), count: rated.length },
    reviews,
    coachCode: u.coachCode ?? null,
    takesConsults: !!row?.takesConsults && !blocked,
  };
}

/** The coach's profile photo for the public page (only while the page is on). */
export async function publicAvatar(username: string): Promise<{ mime: string; bytes: Buffer }> {
  const u = await publicCoachRow(username);
  if (!u) throw notFound();
  const d = await db();
  const [m] = await d.select().from(userMedia).where(and(eq(userMedia.userId, u.id), eq(userMedia.kind, "avatar"))).limit(1);
  if (!m) throw notFound();
  return { mime: m.mime, bytes: Buffer.from(m.dataB64, "base64") };
}

/** Short card for a trainer shown inside a consult (name, photo, headline and the link to their page). */
export async function trainerCard(trainerId: string): Promise<{ id: string; name: string; slug: string; headline: string; avatarV: number; profilePath: string | null; rating: number | null } | null> {
  const d = await db();
  const [u] = await d.select().from(users).where(eq(users.id, trainerId)).limit(1);
  if (!u) return null;
  const row = await rowOf(u.id);
  const data = row ? parse(row.data) : EMPTY;
  const stars = await d.select({ stars: consults.stars }).from(consults).where(and(eq(consults.trainerId, u.id), isNotNull(consults.stars)));
  const visible = !row || row.isPublic;
  return {
    id: u.id,
    name: displayName(u),
    slug: publicSlug(u),
    headline: data.headline,
    avatarV: cleanPrefs(safeJson(u.prefs)).avatarV ?? 0,
    profilePath: visible ? `/coach/${publicSlug(u)}` : null,
    rating: averageStars(stars.map((s) => s.stars ?? 0).filter((n) => n > 0)),
  };
}
