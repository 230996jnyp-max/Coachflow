import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { cleanAssessment, emptyAssessment, factsFor, hasContent, isView, type AssessmentData, type OtherEntry, type PhotoView } from "@/lib/assessment";
import { isMinorRow, loadClientFor, openProfile } from "./accounts";
import { aiAssessmentNote, aiConfigured } from "./ai";
import { logAiUsage } from "./aiLog";
import { takeAiQuota } from "./aiQuota";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { notify } from "./groups";
import { requireAdult } from "./minors";
import { assessmentPhotos, assessments, users, type UserRow } from "./schema";

/*
 * Posture and fitness assessments. A coach does one with a client (on the first session, then every 8 to 12 weeks), and a client can fill
 * in one of their own; the coach is told when they do. A coach's finished assessment is given to the client as a copy, which they
 * read and acknowledge. Items the coach writes under "Others" carry over to the next assessment so they can be compared like the rest.
 * Assessments are never visible to a gym.
 */

const aadA = (id: string) => `assessment:${id}`;
const aadP = (id: string) => `assessment-photo:${id}`;
const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
const today = () => new Date().toISOString().slice(0, 10);
const nameOf = (u: UserRow) => {
  try {
    return (u.role === "CLIENT" ? openProfile(u).name : (u.name ?? u.username)).trim() || "Someone";
  } catch {
    return "Someone";
  }
};
const first = (u: UserRow) => nameOf(u).split(/\s+/)[0];

export interface AssessmentRecord {
  id: string;
  clientId: string;
  filledBy: "COACH" | "CLIENT";
  status: "DRAFT" | "DONE";
  takenAt: string;
  createdAt: string;
  updatedAt: string;
  sharedAt: string | null;
  ackAt: string | null;
  seenAt: string | null;
  photos: PhotoView[];
  data: AssessmentData;
}

type Row = typeof assessments.$inferSelect;

function open(row: Row, photos: PhotoView[]): AssessmentRecord | null {
  try {
    const data = decryptJson<AssessmentData>(row.dataEnc, aadA(row.id));
    return {
      id: row.id,
      clientId: row.clientId,
      filledBy: row.filledBy === "CLIENT" ? "CLIENT" : "COACH",
      status: row.status === "DONE" ? "DONE" : "DRAFT",
      takenAt: row.takenAt,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      sharedAt: row.sharedAt ? row.sharedAt.toISOString() : null,
      ackAt: row.ackAt ? row.ackAt.toISOString() : null,
      seenAt: row.seenAt ? row.seenAt.toISOString() : null,
      photos,
      data,
    };
  } catch (e) {
    console.error("Could not decrypt an assessment", row.id, e);
    return null;
  }
}

async function photosOf(ids: string[]): Promise<Map<string, PhotoView[]>> {
  const out = new Map<string, PhotoView[]>();
  if (!ids.length) return out;
  const d = await db();
  const rows = await d.select({ assessmentId: assessmentPhotos.assessmentId, view: assessmentPhotos.view }).from(assessmentPhotos).where(inArray(assessmentPhotos.assessmentId, ids));
  for (const r of rows) if (isView(r.view)) out.set(r.assessmentId, [...(out.get(r.assessmentId) ?? []), r.view]);
  return out;
}

/** What a viewer may see: a coach sees everything of their own client; a client sees their own, and a coach's only once it was given to them. */
function visibleTo(viewer: UserRow, row: Row): boolean {
  if (viewer.role === "CLIENT") return row.clientId === viewer.id && (row.filledBy === "CLIENT" || !!row.sharedAt);
  // A client's unfinished draft is theirs until they hand it in.
  return row.coachId === viewer.id && (row.filledBy === "COACH" || row.status === "DONE");
}

export async function listAssessments(viewer: UserRow, clientId: string): Promise<AssessmentRecord[]> {
  if (viewer.role === "CLIENT") {
    if (viewer.id !== clientId) throw notFound("Client not found.");
  } else if (!(await loadClientFor(viewer, clientId))) throw notFound("Client not found.");
  const d = await db();
  const rows = (await d.select().from(assessments).where(eq(assessments.clientId, clientId)).orderBy(desc(assessments.takenAt), desc(assessments.createdAt))).filter((r) => visibleTo(viewer, r));
  const photos = await photosOf(rows.map((r) => r.id));
  return rows.map((r) => open(r, photos.get(r.id) ?? [])).filter((x): x is AssessmentRecord => !!x);
}

/** Items the coach wrote under "Others" last time, so the new assessment lists them again. */
async function carriedOthers(viewer: UserRow, clientId: string): Promise<OtherEntry[]> {
  const d = await db();
  const all = await d.select().from(assessments).where(eq(assessments.clientId, clientId)).orderBy(desc(assessments.takenAt), desc(assessments.createdAt)).limit(12);
  // Only what this person is allowed to see carries over (never another person's draft).
  const rows = all.filter((r) => visibleTo(viewer, r)).slice(0, 6);
  const seen = new Map<string, OtherEntry>();
  for (const r of rows) {
    try {
      const data = decryptJson<AssessmentData>(r.dataEnc, aadA(r.id));
      for (const o of data.others ?? []) if (!seen.has(o.id)) seen.set(o.id, o);
    } catch {
      /* skip */
    }
  }
  return [...seen.values()];
}

/** Starts an assessment. A coach starts one for a client of theirs; a client starts their own. */
export async function createAssessment(me: UserRow, clientId?: string): Promise<AssessmentRecord> {
  const d = await db();
  let client: UserRow;
  let filledBy: "COACH" | "CLIENT";
  if (me.role === "CLIENT") {
    if (!me.coachId) throw forbidden("Ask a coach first. Assessments are shared with your coach.");
    client = me;
    filledBy = "CLIENT";
  } else {
    const c = await loadClientFor(me, clientId ?? "");
    if (!c || !c.active) throw notFound("Client not found.");
    client = c;
    filledBy = "COACH";
  }
  const id = newId("as");
  const data = emptyAssessment(today(), await carriedOthers(me, client.id));
  await d.insert(assessments).values({ id, clientId: client.id, coachId: client.coachId!, filledBy, status: "DRAFT", takenAt: data.takenAt, dataEnc: encryptJson(data, aadA(id)) });
  const [row] = await d.select().from(assessments).where(eq(assessments.id, id)).limit(1);
  return open(row, [])!;
}

async function mine(me: UserRow, id: string): Promise<Row> {
  const d = await db();
  const [row] = await d.select().from(assessments).where(eq(assessments.id, id)).limit(1);
  if (!row || !visibleTo(me, row)) throw notFound("That assessment wasn't found.");
  return row;
}

/** Reads one assessment. The coach opening a client's own assessment marks it seen. */
export async function getAssessment(me: UserRow, id: string): Promise<AssessmentRecord> {
  const row = await mine(me, id);
  const d = await db();
  if (me.role !== "CLIENT" && row.filledBy === "CLIENT" && !row.seenAt) await d.update(assessments).set({ seenAt: new Date() }).where(eq(assessments.id, id));
  const photos = await photosOf([id]);
  return open(row, photos.get(id) ?? [])!;
}

/**
 * Saves what was filled in. The author edits their own (a client until they hand it in; the coach until they like). `finish` marks it
 * done: a client handing theirs in tells the coach.
 */
export async function saveAssessment(me: UserRow, id: string, raw: unknown, opts: { finish?: boolean } = {}): Promise<AssessmentRecord> {
  const row = await mine(me, id);
  const byClient = me.role === "CLIENT";
  if (byClient && (row.filledBy !== "CLIENT" || row.status === "DONE")) throw forbidden("This one is already handed in. Start a new one to update it.");
  if (!byClient && row.filledBy !== "COACH") throw forbidden("That one is the client's own. Start your own from it.");
  const data = cleanAssessment(raw, row.takenAt);
  // A client can't write the coach's notes, and the coach doesn't write the client's.
  if (byClient) data.coachNotes = "";
  else data.clientNotes = "";
  if (opts.finish && !hasContent(data)) throw badRequest("Fill in at least one thing before finishing.");
  const d = await db();
  await d
    .update(assessments)
    .set({ dataEnc: encryptJson(data, aadA(id)), takenAt: data.takenAt, updatedAt: new Date(), ...(opts.finish ? { status: "DONE" } : {}) })
    .where(eq(assessments.id, id));
  if (byClient && opts.finish) {
    const [coach] = await d.select().from(users).where(eq(users.id, row.coachId)).limit(1);
    if (coach) await notify([coach.id], "assessment_submitted", { title: `${first(me)} filled in a self-assessment`, body: `${first(me)} handed in their own posture and fitness assessment. Have a look before you meet, and use it as a starting point for yours.`, link: `/clients/${me.id}`, about: me.id });
  }
  const photos = await photosOf([id]);
  const [fresh] = await d.select().from(assessments).where(eq(assessments.id, id)).limit(1);
  return open(fresh, photos.get(id) ?? [])!;
}

/** The coach gives the client a copy of a finished assessment (or takes it back). The client reads it and acknowledges it. */
export async function shareAssessment(coach: UserRow, id: string, share: boolean): Promise<void> {
  const row = await mine(coach, id);
  if (coach.role === "CLIENT") throw forbidden("Only the coach can do that.");
  if (row.filledBy !== "COACH") throw badRequest("That one is the client's own, so they already have it.");
  if (share && row.status !== "DONE") throw badRequest("Finish the assessment before giving the client a copy.");
  const d = await db();
  await d.update(assessments).set({ sharedAt: share ? new Date() : null, ackAt: null }).where(eq(assessments.id, id));
  if (share) await notify([row.clientId], "assessment_shared", { title: "Your coach shared your assessment", body: `${coach.name ?? "Your coach"} did a posture and fitness assessment with you and gave you a copy. Please read it and tap Acknowledge.`, link: "/intake" });
}

export async function acknowledgeAssessment(client: UserRow, id: string): Promise<void> {
  const row = await mine(client, id);
  if (row.filledBy !== "COACH" || !row.sharedAt) throw notFound("That copy isn't available yet.");
  if (row.ackAt) return;
  const d = await db();
  await d.update(assessments).set({ ackAt: new Date() }).where(eq(assessments.id, id));
  await notify([row.coachId], "assessment_ack", { title: `${first(client)} acknowledged their assessment`, body: `${first(client)} read and acknowledged the assessment you gave them.`, link: `/clients/${client.id}`, about: client.id }, { email: false });
}

export async function deleteAssessment(me: UserRow, id: string): Promise<void> {
  const row = await mine(me, id);
  if (me.role === "CLIENT" && (row.filledBy !== "CLIENT" || row.status === "DONE")) throw forbidden("You can only delete a draft of your own.");
  if (me.role !== "CLIENT" && row.filledBy !== "COACH") throw forbidden("That one is the client's own.");
  const d = await db();
  await d.delete(assessmentPhotos).where(eq(assessmentPhotos.assessmentId, id));
  await d.delete(assessments).where(eq(assessments.id, id));
}

/* ---------------- Photos ---------------- */
const MIMES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_LIMIT = 700_000;

export async function putPhoto(me: UserRow, id: string, view: string, mime: unknown, data: unknown): Promise<void> {
  if (!isView(view)) throw badRequest("Choose front, side or back.");
  const row = await mine(me, id);
  const byClient = me.role === "CLIENT";
  if (byClient) {
    if (row.filledBy !== "CLIENT" || row.status === "DONE") throw forbidden("You can't add pictures to this one.");
    if (isMinorRow(me)) throw forbidden("Under 18: your coach adds posture photos with you.");
  } else if (row.filledBy !== "COACH") throw forbidden("That one is the client's own.");
  if (typeof mime !== "string" || !MIMES.includes(mime)) throw badRequest("Use a JPEG, PNG or WebP picture.");
  if (typeof data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(data)) throw badRequest("That picture couldn't be read.");
  if (data.length > PHOTO_LIMIT) throw badRequest("That picture is too large. Choose a smaller one.");
  const d = await db();
  const pid = newId("ap");
  await d.delete(assessmentPhotos).where(and(eq(assessmentPhotos.assessmentId, id), eq(assessmentPhotos.view, view)));
  await d.insert(assessmentPhotos).values({ id: pid, assessmentId: id, clientId: row.clientId, view, dataEnc: encryptJson({ mime, data }, aadP(pid)) });
}

export async function readPhoto(me: UserRow, id: string, view: string): Promise<{ mime: string; bytes: Buffer }> {
  if (!isView(view)) throw notFound();
  await mine(me, id);
  const d = await db();
  const [p] = await d.select().from(assessmentPhotos).where(and(eq(assessmentPhotos.assessmentId, id), eq(assessmentPhotos.view, view))).limit(1);
  if (!p) throw notFound();
  const x = decryptJson<{ mime: string; data: string }>(p.dataEnc, aadP(p.id));
  return { mime: x.mime, bytes: Buffer.from(x.data, "base64") };
}

export async function deletePhoto(me: UserRow, id: string, view: string): Promise<void> {
  if (!isView(view)) throw badRequest("Choose front, side or back.");
  const row = await mine(me, id);
  if (me.role === "CLIENT" && (row.filledBy !== "CLIENT" || row.status === "DONE")) throw forbidden("You can't change this one.");
  if (me.role !== "CLIENT" && row.filledBy !== "COACH") throw forbidden("That one is the client's own.");
  const d = await db();
  await d.delete(assessmentPhotos).where(and(eq(assessmentPhotos.assessmentId, id), eq(assessmentPhotos.view, view)));
}

/* ---------------- An optional plain-English summary (AI, adults only) ---------------- */
export async function aiSummary(coach: UserRow, id: string): Promise<string | null> {
  if (coach.role === "CLIENT") throw forbidden("Only the coach can do that.");
  const row = await mine(coach, id);
  const client = await loadClientFor(coach, row.clientId);
  if (!client) throw notFound();
  requireAdult(client);
  if (!aiConfigured()) return null;
  const data = decryptJson<AssessmentData>(row.dataEnc, aadA(id));
  const facts = factsFor(data);
  if (!facts) throw conflict("Fill in some findings first.");
  await takeAiQuota(coach.id, "assessment", 30, "assessment summaries");
  await logAiUsage({ userId: coach.id, feature: "assessment_summary" });
  return aiAssessmentNote(facts);
}

/* ---------------- Removing everything of a client ---------------- */
export async function purgeClientAssessments(clientId: string): Promise<void> {
  const d = await db();
  await d.delete(assessmentPhotos).where(eq(assessmentPhotos.clientId, clientId));
  await d.delete(assessments).where(eq(assessments.clientId, clientId));
}

/** Waiting for the coach: client self-assessments handed in and not opened yet. */
export async function unseenSelfAssessments(coachId: string): Promise<Record<string, number>> {
  const d = await db();
  const rows = await d.select({ clientId: assessments.clientId }).from(assessments).where(and(eq(assessments.coachId, coachId), eq(assessments.filledBy, "CLIENT"), eq(assessments.status, "DONE"), isNull(assessments.seenAt)));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.clientId] = (out[r.clientId] ?? 0) + 1;
  return out;
}
