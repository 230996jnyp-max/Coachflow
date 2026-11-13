import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lt, max, sql } from "drizzle-orm";
import {
  FORM_KINDS,
  FORM_LABEL,
  cleanForm,
  healthNoteLine,
  parqFlags,
  withHealthLine,
  type FormData,
  type FormKind,
  type GoalsData,
  type ParqData,
} from "@/lib/intakeForms";
import { isMinorRow, loadClientFor, openProfile, sealProfile } from "./accounts";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { badRequest, forbidden, notFound, str } from "./http";
import { notify } from "./groups";
import { bookings, intakeForms, intakeRequests, users, type UserRow } from "./schema";

/*
 * "Before we meet". A coach asks a client to fill in a pack of forms (health questionnaire, declaration, goals). Every submission is
 * kept as a new version. The coach reviews it and gives the client a copy; the client reads it and acknowledges it. Nothing here is ever
 * visible to a gym.
 */

const aadForm = (id: string) => `intake:${id}`;
const aadReview = (id: string) => `intake-review:${id}`;
const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
const firstName = (u: UserRow) => {
  try {
    return (u.role === "CLIENT" ? openProfile(u).name : (u.name ?? u.username)).trim().split(/\s+/)[0] || "Your client";
  } catch {
    return "Your client";
  }
};

export interface FormRecord {
  id: string;
  kind: FormKind;
  version: number;
  submittedAt: string;
  flags: number;
  reviewedAt: string | null;
  sharedAt: string | null;
  ackAt: string | null;
  /** The coach's note on it (only once it has been shared with the client). */
  reviewNote: string;
  data: FormData[FormKind];
}

export interface IntakeState {
  /** The newest version of each form (or null when it hasn't been filled in). */
  current: Record<FormKind, FormRecord | null>;
  /** Every version, newest first. */
  history: FormRecord[];
  request: { id: string; kinds: FormKind[]; createdAt: string; complete: boolean } | null;
}

function toRecord(row: typeof intakeForms.$inferSelect, forClient: boolean): FormRecord | null {
  try {
    const data = decryptJson<FormData[FormKind]>(row.dataEnc, aadForm(row.id));
    let note = "";
    if (row.reviewEnc && (!forClient || row.sharedAt)) note = decryptJson<{ note: string }>(row.reviewEnc, aadReview(row.id)).note ?? "";
    return {
      id: row.id,
      kind: row.kind as FormKind,
      version: row.version,
      submittedAt: row.submittedAt.toISOString(),
      flags: row.flags,
      reviewedAt: forClient && !row.sharedAt ? null : row.reviewedAt ? row.reviewedAt.toISOString() : null,
      sharedAt: row.sharedAt ? row.sharedAt.toISOString() : null,
      ackAt: row.ackAt ? row.ackAt.toISOString() : null,
      reviewNote: note,
      data,
    };
  } catch (e) {
    console.error("Could not decrypt an intake form", row.id, e);
    return null;
  }
}

/** The kinds that count for a pack (a request may ask for fewer than all three). */
const kindsOf = (json: string): FormKind[] => {
  try {
    const x = JSON.parse(json);
    return Array.isArray(x) ? x.filter((k): k is FormKind => (FORM_KINDS as readonly string[]).includes(k)) : [...FORM_KINDS];
  } catch {
    return [...FORM_KINDS];
  }
};

export async function intakeFor(viewer: UserRow, clientId: string): Promise<IntakeState> {
  let client: UserRow | null;
  if (viewer.role === "CLIENT") client = viewer.id === clientId ? viewer : null;
  else client = await loadClientFor(viewer, clientId);
  if (!client) throw notFound("Client not found.");
  const forClient = viewer.role === "CLIENT";
  const d = await db();
  const rows = await d.select().from(intakeForms).where(eq(intakeForms.clientId, client.id)).orderBy(desc(intakeForms.submittedAt));
  const history = rows.map((r) => toRecord(r, forClient)).filter((x): x is FormRecord => !!x);
  const current = { PARQ: null, DECLARATION: null, GOALS: null } as Record<FormKind, FormRecord | null>;
  for (const h of history) if (!current[h.kind]) current[h.kind] = h;
  const [req] = await d.select().from(intakeRequests).where(eq(intakeRequests.clientId, client.id)).orderBy(desc(intakeRequests.createdAt)).limit(1);
  const kinds = req ? kindsOf(req.kinds) : [];
  return {
    current,
    history,
    request: req ? { id: req.id, kinds, createdAt: req.createdAt.toISOString(), complete: kinds.every((k) => !!current[k]) } : null,
  };
}

/* ---------------- Asking for the pack ---------------- */
export async function requestPack(coach: UserRow, clientId: string, kinds?: unknown): Promise<string> {
  const client = await loadClientFor(coach, clientId);
  if (!client || !client.active) throw notFound("Client not found.");
  const list = Array.isArray(kinds) ? kinds.filter((k): k is FormKind => (FORM_KINDS as readonly string[]).includes(k)) : [...FORM_KINDS];
  const wanted = list.length ? [...new Set(list)] : [...FORM_KINDS];
  const d = await db();
  const id = newId("ir");
  await d.insert(intakeRequests).values({ id, clientId: client.id, coachId: coach.id, kinds: JSON.stringify(wanted) });
  await notify([client.id], "intake_request", { title: "Before we meet", body: `${coach.name ?? "Your coach"} asked you to fill in ${wanted.length === 1 ? `the ${FORM_LABEL[wanted[0]].toLowerCase()}` : "a few short forms"} before your first session: ${wanted.map((k) => FORM_LABEL[k].toLowerCase()).join(", ")}. It takes about five minutes.`, link: "/intake" });
  return id;
}

/* ---------------- Submitting a form ---------------- */
export async function submitForm(client: UserRow, kindRaw: unknown, raw: unknown): Promise<FormRecord> {
  if (client.role !== "CLIENT") throw forbidden("Forms are filled in by the client.");
  if (!client.coachId) throw forbidden("Ask a coach to send you these forms first.");
  const kind = (FORM_KINDS as readonly string[]).includes(String(kindRaw)) ? (kindRaw as FormKind) : null;
  if (!kind) throw badRequest("Unknown form.");
  const minor = isMinorRow(client);
  const res = cleanForm(kind, raw, { minor });
  if (!res.ok) throw badRequest(res.error);

  const d = await db();
  const [{ v }] = await d.select({ v: max(intakeForms.version) }).from(intakeForms).where(and(eq(intakeForms.clientId, client.id), eq(intakeForms.kind, kind)));
  const version = Number(v ?? 0) + 1;
  const flags = kind === "PARQ" ? parqFlags(res.data as ParqData).length : 0;
  const id = newId("if");
  await d.insert(intakeForms).values({ id, clientId: client.id, coachId: client.coachId, kind, version, dataEnc: encryptJson(res.data, aadForm(id)), flags });

  // What the form says goes where the coach already looks.
  const p = openProfile(client);
  const today = new Date().toISOString().slice(0, 10);
  if (kind === "PARQ") p.medicalNotes = withHealthLine(p.medicalNotes ?? "", healthNoteLine(res.data as ParqData, today));
  if (kind === "GOALS") {
    const g = res.data as GoalsData;
    if (g.goalCategory) p.goal = g.goalCategory;
    if (g.experience) p.level = g.experience;
    p.personalGoal = g.mainGoal;
    if (g.targetEvent) p.goalEventName = g.targetEvent;
    if (g.targetDate) p.goalEventDate = g.targetDate;
  }
  if (kind === "DECLARATION") p.consent = { at: new Date().toISOString(), ...(minor ? { guardian: true } : {}) };
  await d.update(users).set({ profileEnc: sealProfile(client.id, p), updatedAt: new Date() }).where(eq(users.id, client.id));

  const who = firstName(client);
  const warn = kind === "PARQ" && flags > 0 ? ` ${flags} yes ${flags === 1 ? "answer" : "answers"}: medical clearance is recommended.` : "";
  await notify([client.coachId], "intake_submitted", { title: `${who} filled in the ${FORM_LABEL[kind].toLowerCase()}`, body: `${who} completed the ${FORM_LABEL[kind].toLowerCase()}${version > 1 ? ` (an update, version ${version})` : ""}.${warn}`, link: `/clients/${client.id}`, about: client.id });
  const [row] = await d.select().from(intakeForms).where(eq(intakeForms.id, id)).limit(1);
  return toRecord(row, true)!;
}

/* ---------------- Review, copy and acknowledgement ---------------- */
/** The coach has looked at a form. With `share`, the client gets a copy (with the coach's note) to read and acknowledge. */
export async function reviewForm(coach: UserRow, formId: string, opts: { note?: unknown; share?: unknown }): Promise<void> {
  const d = await db();
  const [row] = await d.select().from(intakeForms).where(eq(intakeForms.id, formId)).limit(1);
  if (!row || row.coachId !== coach.id) throw notFound("That form wasn't found.");
  const client = await loadClientFor(coach, row.clientId);
  if (!client) throw notFound("That form wasn't found.");
  const note = str(opts.note, "Note", { optional: true, max: 800 });
  const share = opts.share !== false;
  await d
    .update(intakeForms)
    .set({ reviewedAt: new Date(), reviewEnc: encryptJson({ note }, aadReview(row.id)), ...(share ? { sharedAt: new Date(), ackAt: null } : {}) })
    .where(eq(intakeForms.id, row.id));
  if (share) await notify([client.id], "intake_reviewed", { title: "Your coach reviewed your form", body: `${coach.name ?? "Your coach"} read your ${FORM_LABEL[row.kind as FormKind].toLowerCase()} and gave you a copy of what was recorded. Please read it and tap Acknowledge.`, link: "/intake" });
}

export async function acknowledgeForm(client: UserRow, formId: string): Promise<void> {
  const d = await db();
  const [row] = await d.select().from(intakeForms).where(and(eq(intakeForms.id, formId), eq(intakeForms.clientId, client.id))).limit(1);
  if (!row || !row.sharedAt) throw notFound("That copy isn't available yet.");
  if (row.ackAt) return;
  await d.update(intakeForms).set({ ackAt: new Date() }).where(eq(intakeForms.id, row.id));
  await notify([row.coachId], "intake_ack", { title: `${firstName(client)} acknowledged their copy`, body: `${firstName(client)} read and acknowledged the ${FORM_LABEL[row.kind as FormKind].toLowerCase()} you gave them.`, link: `/clients/${client.id}`, about: client.id }, { email: false });
}

/* ---------------- For the coach's lists ---------------- */
export interface IntakeFlag {
  /** Yes answers on the newest health questionnaire. */
  healthFlags: number;
  /** That questionnaire hasn't been reviewed yet. */
  needsReview: boolean;
  /** A pack was asked for and not everything is filled in yet. */
  pending: boolean;
}

/** One small record per client of this coach, for the Needs You list and the client page. Counts only; no answers. */
export async function intakeFlagsFor(coachId: string): Promise<Record<string, IntakeFlag>> {
  const d = await db();
  const forms = await d.select({ clientId: intakeForms.clientId, kind: intakeForms.kind, version: intakeForms.version, flags: intakeForms.flags, reviewedAt: intakeForms.reviewedAt }).from(intakeForms).where(eq(intakeForms.coachId, coachId)).orderBy(desc(intakeForms.version));
  const reqs = await d.select().from(intakeRequests).where(eq(intakeRequests.coachId, coachId)).orderBy(desc(intakeRequests.createdAt));
  const out: Record<string, IntakeFlag> = {};
  const seen = new Set<string>();
  for (const f of forms) {
    const key = `${f.clientId}|${f.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (f.kind === "PARQ") out[f.clientId] = { healthFlags: f.flags, needsReview: f.flags > 0 && !f.reviewedAt, pending: false };
  }
  const latestReq = new Map<string, (typeof reqs)[number]>();
  for (const r of reqs) if (!latestReq.has(r.clientId)) latestReq.set(r.clientId, r);
  for (const [clientId, r] of latestReq) {
    const done = kindsOf(r.kinds).every((k) => seen.has(`${clientId}|${k}`));
    out[clientId] = { healthFlags: out[clientId]?.healthFlags ?? 0, needsReview: out[clientId]?.needsReview ?? false, pending: !done };
  }
  return out;
}

/** What a client sees at the top of their home: forms still to do, and copies waiting for their acknowledgement. */
export async function intakeTodoFor(client: UserRow): Promise<{ missing: FormKind[]; toAcknowledge: number; hasRequest: boolean }> {
  const d = await db();
  const [req] = await d.select().from(intakeRequests).where(eq(intakeRequests.clientId, client.id)).orderBy(desc(intakeRequests.createdAt)).limit(1);
  const rows = await d.select({ kind: intakeForms.kind, sharedAt: intakeForms.sharedAt, ackAt: intakeForms.ackAt }).from(intakeForms).where(eq(intakeForms.clientId, client.id));
  const have = new Set(rows.map((r) => r.kind));
  const missing = req ? kindsOf(req.kinds).filter((k) => !have.has(k)) : [];
  return { missing, toAcknowledge: rows.filter((r) => r.sharedAt && !r.ackAt).length, hasRequest: !!req };
}

/* ---------------- Reminder before the first session ---------------- */
/**
 * Clients who still owe forms and have a session in the next 24 hours get one reminder (the client, and a note to the coach). Safe to
 * run as often as you like: each request is only reminded once. Called by the daily job and when a coach or client opens the app.
 */
export async function sendIntakeReminders(only?: { clientId?: string; coachId?: string }): Promise<number> {
  const d = await db();
  const open = await d.select().from(intakeRequests).where(and(isNull(intakeRequests.reminderSentAt), only?.clientId ? eq(intakeRequests.clientId, only.clientId) : sql`true`, only?.coachId ? eq(intakeRequests.coachId, only.coachId) : sql`true`));
  let sent = 0;
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 3_600_000);
  for (const r of open) {
    // Only the newest request per client counts.
    const [newest] = await d.select({ id: intakeRequests.id }).from(intakeRequests).where(eq(intakeRequests.clientId, r.clientId)).orderBy(desc(intakeRequests.createdAt)).limit(1);
    if (newest?.id !== r.id) continue;
    const kinds = kindsOf(r.kinds);
    const done = await d.select({ kind: intakeForms.kind }).from(intakeForms).where(and(eq(intakeForms.clientId, r.clientId), inArray(intakeForms.kind, kinds)));
    if (kinds.every((k) => done.some((x) => x.kind === k))) continue;
    const [next] = await d
      .select({ start: bookings.startAt })
      .from(bookings)
      .where(and(eq(bookings.clientId, r.clientId), inArray(bookings.status, ["CONFIRMED", "PENDING"]), gt(bookings.startAt, now), lt(bookings.startAt, soon)))
      .limit(1);
    if (!next) continue;
    const [client] = await d.select().from(users).where(eq(users.id, r.clientId)).limit(1);
    if (!client || !client.active) continue;
    // Claim the request first, so two runs at once can't both send.
    const claimed = await d.update(intakeRequests).set({ reminderSentAt: now }).where(and(eq(intakeRequests.id, r.id), isNull(intakeRequests.reminderSentAt))).returning({ id: intakeRequests.id });
    if (!claimed.length) continue;
    const missing = kinds.filter((k) => !done.some((x) => x.kind === k));
    await notify([client.id], "intake_reminder", { title: "A reminder before your session", body: `Your session is coming up soon. Please fill in: ${missing.map((k) => FORM_LABEL[k].toLowerCase()).join(", ")}. It takes about five minutes and helps your coach plan.`, link: "/intake" });
    await notify([r.coachId], "intake_reminder", { title: `${firstName(client)} hasn't filled in their forms`, body: `${firstName(client)} has a session within 24 hours and still owes: ${missing.map((k) => FORM_LABEL[k].toLowerCase()).join(", ")}. A reminder was sent.`, link: `/clients/${client.id}`, about: client.id }, { email: false });
    sent++;
  }
  return sent;
}

/* ---------------- Removing everything of a client ---------------- */
export async function purgeClientIntake(clientId: string): Promise<void> {
  const d = await db();
  await d.delete(intakeForms).where(eq(intakeForms.clientId, clientId));
  await d.delete(intakeRequests).where(eq(intakeRequests.clientId, clientId));
}

