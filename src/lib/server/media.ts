import "server-only";
import { and, eq } from "drizzle-orm";
import { MEDIA_KINDS, VERSION_KEY, cleanPrefs, parsePrefs, type MediaKind, type Prefs } from "@/lib/prefs";
import { isMinorRow } from "./accounts";
import { db } from "./db";
import { badRequest, notFound } from "./http";
import { gymMembers, gymOrgs, userMedia, users, type UserRow } from "./schema";

/** Largest accepted picture, as base64 characters. The browser shrinks pictures before sending, so these are generous. */
const LIMIT: Record<MediaKind, number> = { avatar: 160_000, bg: 1_100_000, banner: 700_000, logo: 260_000 };
const MIMES = ["image/jpeg", "image/png", "image/webp"];

export const isKind = (v: unknown): v is MediaKind => typeof v === "string" && (MEDIA_KINDS as readonly string[]).includes(v);

/** Merges `patch` into the person's saved preferences (only known, valid fields) and saves. Returns the result. */
export async function savePrefs(me: UserRow, patch: Record<string, unknown>): Promise<Prefs> {
  const d = await db();
  // Picture versions are set by uploading, never by a plain preferences edit.
  const clean = cleanPrefs(patch);
  for (const k of Object.values(VERSION_KEY)) delete clean[k];
  const [fresh] = await d.select({ prefs: users.prefs }).from(users).where(eq(users.id, me.id)).limit(1);
  const next: Prefs = { ...parsePrefs(fresh?.prefs), ...clean };
  if (next.bio === "") delete next.bio;
  if (next.nick === "") delete next.nick;
  if (next.quiet === null) delete next.quiet;
  await d.update(users).set({ prefs: JSON.stringify(next), updatedAt: new Date() }).where(eq(users.id, me.id));
  return next;
}

/** Stores a picture (base64, no "data:" prefix) and bumps its version so every device fetches the new one. */
export async function putMedia(me: UserRow, kind: MediaKind, mime: unknown, data: unknown): Promise<Prefs> {
  if (typeof mime !== "string" || !MIMES.includes(mime)) throw badRequest("Use a JPEG, PNG or WebP picture.");
  if (typeof data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(data)) throw badRequest("That picture couldn't be read.");
  if (data.length > LIMIT[kind]) throw badRequest("That picture is too large. Choose a smaller one.");
  const d = await db();
  await d
    .insert(userMedia)
    .values({ userId: me.id, kind, mime, dataB64: data })
    .onConflictDoUpdate({ target: [userMedia.userId, userMedia.kind], set: { mime, dataB64: data, updatedAt: new Date() } });
  return bumpVersion(me, kind, Date.now());
}

export async function deleteMedia(me: UserRow, kind: MediaKind): Promise<Prefs> {
  const d = await db();
  await d.delete(userMedia).where(and(eq(userMedia.userId, me.id), eq(userMedia.kind, kind)));
  return bumpVersion(me, kind, 0);
}

async function bumpVersion(me: UserRow, kind: MediaKind, v: number): Promise<Prefs> {
  const d = await db();
  const [fresh] = await d.select({ prefs: users.prefs }).from(users).where(eq(users.id, me.id)).limit(1);
  const next: Prefs = { ...parsePrefs(fresh?.prefs), [VERSION_KEY[kind]]: v };
  if (!v) delete next[VERSION_KEY[kind]];
  if (kind === "bg" && !v && next.bg === "custom") next.bg = "none";
  await d.update(users).set({ prefs: JSON.stringify(next), updatedAt: new Date() }).where(eq(users.id, me.id));
  return next;
}

/**
 * Who may see whose picture. A background is private to its owner. A profile photo is seen by the person, their coach and the clients
 * they coach (and other staff); a minor's photo only by themselves and their coach. A coach's banner and logo are seen by their clients.
 */
export function mayView(viewer: UserRow, target: UserRow, kind: MediaKind): boolean {
  if (viewer.id === target.id) return true;
  if (kind === "bg") return false;
  const viewerStaff = viewer.role !== "CLIENT";
  const targetStaff = target.role !== "CLIENT";
  if (kind === "banner" || kind === "logo") return targetStaff && (viewerStaff || viewer.coachId === target.id);
  // avatar
  if (isMinorRow(target)) return viewerStaff && target.coachId === viewer.id;
  if (viewerStaff && targetStaff) return true;
  if (viewerStaff) return target.coachId === viewer.id;
  return viewer.coachId === target.id;
}

export async function readMedia(viewer: UserRow, targetId: string, kind: MediaKind): Promise<{ mime: string; bytes: Buffer }> {
  const d = await db();
  const [target] = await d.select().from(users).where(eq(users.id, targetId)).limit(1);
  // Same answer whether the person or the picture is missing, so this can't be used to find who exists.
  if (!target || !mayView(viewer, target, kind)) throw notFound();
  const [row] = await d.select().from(userMedia).where(and(eq(userMedia.userId, targetId), eq(userMedia.kind, kind))).limit(1);
  if (!row) throw notFound();
  return { mime: row.mime, bytes: Buffer.from(row.dataB64, "base64") };
}

/* ---------------- A gym's logo and banner ---------------- */
const GYM_KINDS = ["logo", "banner"] as const;
export type GymMediaKind = (typeof GYM_KINDS)[number];
export const isGymKind = (v: unknown): v is GymMediaKind => typeof v === "string" && (GYM_KINDS as readonly string[]).includes(v);

/** Stores a gym's logo or banner (kept under the gym's id) and bumps its version. */
export async function putGymMedia(gymId: string, kind: GymMediaKind, mime: unknown, data: unknown): Promise<void> {
  if (typeof mime !== "string" || !MIMES.includes(mime)) throw badRequest("Use a JPEG, PNG or WebP picture.");
  if (typeof data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(data)) throw badRequest("That picture couldn't be read.");
  if (data.length > LIMIT[kind]) throw badRequest("That picture is too large. Choose a smaller one.");
  const d = await db();
  await d
    .insert(userMedia)
    .values({ userId: gymId, kind, mime, dataB64: data })
    .onConflictDoUpdate({ target: [userMedia.userId, userMedia.kind], set: { mime, dataB64: data, updatedAt: new Date() } });
  await d.update(gymOrgs).set(kind === "logo" ? { logoV: Date.now() % 2_000_000_000 } : { bannerV: Date.now() % 2_000_000_000 }).where(eq(gymOrgs.id, gymId));
}

export async function deleteGymMedia(gymId: string, kind: GymMediaKind): Promise<void> {
  const d = await db();
  await d.delete(userMedia).where(and(eq(userMedia.userId, gymId), eq(userMedia.kind, kind)));
  await d.update(gymOrgs).set(kind === "logo" ? { logoV: 0 } : { bannerV: 0 }).where(eq(gymOrgs.id, gymId));
}

/** A gym's logo or banner is seen by the gym's people and by the clients of its coaches. */
export async function readGymMedia(viewer: UserRow, gymId: string, kind: GymMediaKind): Promise<{ mime: string; bytes: Buffer }> {
  const d = await db();
  const [gym] = await d.select().from(gymOrgs).where(eq(gymOrgs.id, gymId)).limit(1);
  if (!gym) throw notFound();
  const coachId = viewer.role === "CLIENT" ? viewer.coachId : viewer.id;
  let ok = false;
  if (coachId) {
    const [m] = await d.select().from(gymMembers).where(and(eq(gymMembers.gymId, gymId), eq(gymMembers.userId, coachId))).limit(1);
    ok = !!m && (m.status === "ACTIVE" || viewer.role !== "CLIENT");
  }
  if (viewer.role === "OWNER") ok = true;
  if (!ok) throw notFound();
  const [row] = await d.select().from(userMedia).where(and(eq(userMedia.userId, gymId), eq(userMedia.kind, kind))).limit(1);
  if (!row) throw notFound();
  return { mime: row.mime, bytes: Buffer.from(row.dataB64, "base64") };
}
