import "server-only";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import type { BodyMetricLog, PhotoPose, ProgressPhoto } from "@/lib/types";
import { decrypt, decryptJson, encrypt, encryptJson } from "./crypto";
import { db } from "./db";
import { badRequest, forbidden, notFound } from "./http";
import { bodyLogs, progressPhotos } from "./schema";
import { writableClientIds } from "./training";
import type { UserRow } from "./schema";

/*
 * Body check-ins and progress photos, kept in the database so a coach sees what a client logs on their own phone (and so nothing is
 * lost with a cleared browser). Readable by the client and by that client's coach only. The numbers, notes and the picture are
 * encrypted, each bound to its row id. Lists never read a picture: it is decrypted only when its image address is opened.
 */

export const POSES: PhotoPose[] = ["Front", "Side", "Back", "Other"];
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
/** A shrunk picture is about 100 to 250 KB; this is the most one may take (as a data address, so a little over the file size). */
export const MAX_PHOTO_CHARS = 600_000;
const MAX_LOGS_PER_CLIENT = 3000;
const MAX_PHOTOS_PER_CLIENT = 200;

const aadM = (id: string) => `bodylog:${id}`;
const aadPm = (id: string) => `photometa:${id}`;
const aadPi = (id: string) => `photoimg:${id}`;

/** Where a photo's picture is served from (opened with the signed-in cookie). */
export const photoUrl = (id: string) => `/api/progress/photos/${id}/image`;

function id(v: unknown, name: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw badRequest(`${name} is not valid.`);
  return v;
}

/** A real calendar date written yyyy-MM-dd. */
export function realDate(v: unknown, name = "Date"): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`${name} should be a real date.`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || d.getUTCFullYear() < 1990 || d.getUTCFullYear() > 2100) throw badRequest(`${name} should be a real date.`);
  return v;
}

const METRIC_RANGES: Record<string, [number, number]> = {
  weightKg: [20, 400],
  bodyFat: [1, 80],
  muscleMassKg: [5, 200],
  chest: [20, 300],
  waist: [20, 300],
  hips: [20, 300],
  armL: [5, 100],
  armR: [5, 100],
  thighL: [10, 150],
  thighR: [10, 150],
  calves: [10, 100],
};

export function parseMetric(raw: unknown): BodyMetricLog {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest("Check-in is missing.");
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { id: id(r.id, "Check-in id"), clientId: id(r.clientId, "Client"), date: realDate(r.date), loggedBy: r.loggedBy === "CLIENT" ? "CLIENT" : "TRAINER" };
  let any = false;
  for (const [key, [lo, hi]] of Object.entries(METRIC_RANGES)) {
    const v = r[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw badRequest(`${key} should be a number between ${lo} and ${hi}.`);
    out[key] = Math.round(v * 100) / 100;
    any = true;
  }
  if (!any) throw badRequest("Add at least one measurement.");
  return out as unknown as BodyMetricLog;
}

export interface PhotoInput extends Omit<ProgressPhoto, "dataUrl"> {
  dataUrl: string;
}

export function parsePhoto(raw: unknown): PhotoInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest("Photo is missing.");
  const r = raw as Record<string, unknown>;
  const pose = POSES.find((p) => p === r.pose);
  if (!pose) throw badRequest("Pick a pose.");
  const url = r.dataUrl;
  if (typeof url !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) throw badRequest("That picture could not be read. Choose a JPEG, PNG or WebP image.");
  if (url.length > MAX_PHOTO_CHARS) throw badRequest("That picture is too large. Choose a smaller one.");
  const notes = typeof r.notes === "string" ? r.notes.trim().slice(0, 500) : "";
  const out: PhotoInput = { id: id(r.id, "Photo id"), clientId: id(r.clientId, "Client"), date: realDate(r.date), pose, notes, dataUrl: url };
  if (r.weightKg !== undefined && r.weightKg !== null && r.weightKg !== "") {
    if (typeof r.weightKg !== "number" || !Number.isFinite(r.weightKg) || r.weightKg < 20 || r.weightKg > 400) throw badRequest("Weight should be a number between 20 and 400.");
    out.weightKg = Math.round(r.weightKg * 100) / 100;
  }
  return out;
}

/* ---------------- Reads ---------------- */
export interface BodyPayload {
  metrics: BodyMetricLog[];
  photos: ProgressPhoto[];
  /** Every id `me` can see (lets the browser drop ones deleted elsewhere). */
  metricIds: string[];
  photoIds: string[];
  now: string;
}

function openMetric(row: typeof bodyLogs.$inferSelect): BodyMetricLog | null {
  try {
    const m = decryptJson<BodyMetricLog>(row.dataEnc, aadM(row.id));
    return { ...m, id: row.id, clientId: row.clientId, date: row.date };
  } catch (e) {
    console.error("Could not decrypt body log", row.id, e);
    return null;
  }
}

type PhotoListRow = Pick<typeof progressPhotos.$inferSelect, "id" | "clientId" | "date" | "metaEnc">;
function openPhotoMeta(row: PhotoListRow): ProgressPhoto | null {
  try {
    const m = decryptJson<Pick<ProgressPhoto, "pose" | "notes" | "weightKg">>(row.metaEnc, aadPm(row.id));
    return { id: row.id, clientId: row.clientId, date: row.date, pose: m.pose, notes: m.notes ?? "", ...(m.weightKg ? { weightKg: m.weightKg } : {}), dataUrl: photoUrl(row.id) };
  } catch (e) {
    console.error("Could not decrypt photo details", row.id, e);
    return null;
  }
}

/** Check-ins and photo details for everyone `me` may see; only what changed since `since` when given. Pictures are not included. */
export async function loadBody(me: UserRow, since?: Date): Promise<BodyPayload> {
  const d = await db();
  const clientIds = await writableClientIds(me);
  const mine = (col: typeof bodyLogs.clientId | typeof progressPhotos.clientId) => inArray(col, clientIds);
  const [mIds, pIds, mRows, pRows] = await Promise.all([
    d.select({ id: bodyLogs.id }).from(bodyLogs).where(mine(bodyLogs.clientId)),
    d.select({ id: progressPhotos.id }).from(progressPhotos).where(mine(progressPhotos.clientId)),
    d.select().from(bodyLogs).where(since ? and(mine(bodyLogs.clientId), gte(bodyLogs.updatedAt, since)) : mine(bodyLogs.clientId)).orderBy(desc(bodyLogs.date)).limit(6000),
    d
      .select({ id: progressPhotos.id, clientId: progressPhotos.clientId, date: progressPhotos.date, metaEnc: progressPhotos.metaEnc })
      .from(progressPhotos)
      .where(since ? and(mine(progressPhotos.clientId), gte(progressPhotos.createdAt, since)) : mine(progressPhotos.clientId))
      .orderBy(desc(progressPhotos.date))
      .limit(3000),
  ]);
  return {
    metrics: mRows.map(openMetric).filter((x): x is BodyMetricLog => x !== null),
    photos: pRows.map(openPhotoMeta).filter((x): x is ProgressPhoto => x !== null),
    metricIds: mIds.map((r) => r.id),
    photoIds: pIds.map((r) => r.id),
    now: new Date().toISOString(),
  };
}

/** The picture of one photo: only its client, or that client's coach, may open it. */
export async function getPhotoImage(me: UserRow, photoId: string): Promise<{ mime: string; bytes: Buffer }> {
  if (!ID_RE.test(photoId)) throw notFound("Photo not found.");
  const d = await db();
  const [row] = await d.select().from(progressPhotos).where(eq(progressPhotos.id, photoId)).limit(1);
  if (!row || !(await writableClientIds(me)).includes(row.clientId)) throw notFound("Photo not found.");
  const url = decrypt(row.imageEnc, aadPi(row.id));
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(url);
  if (!m) throw notFound("Photo not found.");
  return { mime: m[1], bytes: Buffer.from(m[2], "base64") };
}

/* ---------------- Writes ---------------- */
/** Saves one check-in. `insert-only` (used when a device uploads what it kept locally) never changes one that already exists. */
export async function putMetric(me: UserRow, raw: unknown, mode: "upsert" | "insert-only" = "upsert"): Promise<BodyMetricLog> {
  const m = parseMetric(raw);
  const allowed = await writableClientIds(me);
  if (!allowed.includes(m.clientId)) throw forbidden("You can't log check-ins for this person.");
  const d = await db();
  const [existing] = await d.select({ id: bodyLogs.id, clientId: bodyLogs.clientId }).from(bodyLogs).where(eq(bodyLogs.id, m.id)).limit(1);
  if (existing) {
    if (mode === "insert-only") return m;
    if (existing.clientId !== m.clientId) throw forbidden();
  } else {
    const [{ n }] = await d.select({ n: count() }).from(bodyLogs).where(eq(bodyLogs.clientId, m.clientId));
    if (Number(n) >= MAX_LOGS_PER_CLIENT) throw badRequest("This person has reached the check-in limit. Remove old ones first.");
  }
  const values = { id: m.id, clientId: m.clientId, date: m.date, dataEnc: encryptJson(m, aadM(m.id)), updatedAt: new Date() };
  await d.insert(bodyLogs).values(values).onConflictDoUpdate({ target: bodyLogs.id, set: { date: values.date, dataEnc: values.dataEnc, updatedAt: values.updatedAt } });
  return m;
}

export async function removeMetric(me: UserRow, metricId: string): Promise<void> {
  if (!ID_RE.test(metricId)) return;
  const d = await db();
  const [row] = await d.select({ clientId: bodyLogs.clientId }).from(bodyLogs).where(eq(bodyLogs.id, metricId)).limit(1);
  if (!row) return;
  if (!(await writableClientIds(me)).includes(row.clientId)) throw notFound("Check-in not found.");
  await d.delete(bodyLogs).where(eq(bodyLogs.id, metricId));
}

/** Saves a photo. A photo never changes once saved, so saving the same id again does nothing. */
export async function putPhoto(me: UserRow, raw: unknown): Promise<ProgressPhoto> {
  const p = parsePhoto(raw);
  const allowed = await writableClientIds(me);
  if (!allowed.includes(p.clientId)) throw forbidden("You can't add photos for this person.");
  const d = await db();
  const [existing] = await d.select({ id: progressPhotos.id, clientId: progressPhotos.clientId }).from(progressPhotos).where(eq(progressPhotos.id, p.id)).limit(1);
  const shown: ProgressPhoto = { id: p.id, clientId: p.clientId, date: p.date, pose: p.pose, notes: p.notes, ...(p.weightKg ? { weightKg: p.weightKg } : {}), dataUrl: photoUrl(p.id) };
  if (existing) {
    if (existing.clientId !== p.clientId) throw forbidden();
    return shown;
  }
  const [{ n }] = await d.select({ n: count() }).from(progressPhotos).where(eq(progressPhotos.clientId, p.clientId));
  if (Number(n) >= MAX_PHOTOS_PER_CLIENT) throw badRequest("This person has reached the photo limit. Delete some old photos first.");
  await d.insert(progressPhotos).values({
    id: p.id,
    clientId: p.clientId,
    date: p.date,
    metaEnc: encryptJson({ pose: p.pose, notes: p.notes, ...(p.weightKg ? { weightKg: p.weightKg } : {}) }, aadPm(p.id)),
    imageEnc: encrypt(p.dataUrl, aadPi(p.id)),
  });
  return shown;
}

export async function removePhoto(me: UserRow, photoId: string): Promise<void> {
  if (!ID_RE.test(photoId)) return;
  const d = await db();
  const [row] = await d.select({ clientId: progressPhotos.clientId }).from(progressPhotos).where(eq(progressPhotos.id, photoId)).limit(1);
  if (!row) return;
  if (!(await writableClientIds(me)).includes(row.clientId)) throw notFound("Photo not found.");
  await d.delete(progressPhotos).where(eq(progressPhotos.id, photoId));
}

/** When a client is deleted, their check-ins and photos go too. */
export async function purgeClientBody(clientId: string): Promise<void> {
  const d = await db();
  await d.delete(bodyLogs).where(eq(bodyLogs.clientId, clientId));
  await d.delete(progressPhotos).where(eq(progressPhotos.clientId, clientId));
}
