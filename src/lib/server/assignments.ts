import "server-only";
import { randomUUID } from "node:crypto";
import { format, parseISO } from "date-fns";
import { and, count, eq, gte, inArray, lte } from "drizzle-orm";
import { dayKey, MAX_PER_DAY, MAX_REPEAT_WEEKS, weeklyDates } from "@/lib/assignments";
import type { Assignment, TemplateExercise } from "@/lib/types";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { notify } from "./groups";
import { badRequest, forbidden, notFound, str } from "./http";
import { hit } from "./rateLimit";
import { assignments, templates, users, type UserRow } from "./schema";
import { openTemplate } from "./training";
import { loadClientFor } from "./accounts";
import { realDate } from "./bodyData";

/*
 * Workouts a coach assigns to a client for a day. Only that coach and that client can read or change them. The plan is a copy of the
 * routine made at the time (title, note and exercises, encrypted), so editing the routine later does not rewrite what was assigned.
 */

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const aad = (id: string) => `assignment:${id}`;
const MAX_PER_CLIENT = 800;
/** How far back an assignment may be dated (to log or correct recent days) and ahead (about six months, always inside what the app loads). */
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;
/** What the browser loads: enough history for the 30-day score, and the coming months. */
const LOAD_PAST_DAYS = 100;
const LOAD_FUTURE_DAYS = 200;

interface Plan {
  title: string;
  note: string;
  templateId?: string;
  exercises: TemplateExercise[];
  doneManually?: boolean;
}

type Row = typeof assignments.$inferSelect;

function open(row: Row): Assignment | null {
  try {
    const p = decryptJson<Plan>(row.dataEnc, aad(row.id));
    return {
      id: row.id,
      clientId: row.clientId,
      date: row.date,
      title: p.title,
      note: p.note ?? "",
      ...(p.templateId ? { templateId: p.templateId } : {}),
      ...(row.seriesId ? { seriesId: row.seriesId } : {}),
      exercises: p.exercises ?? [],
      ...(p.doneManually ? { doneManually: true } : {}),
      createdAt: row.createdAt.toISOString(),
    };
  } catch (e) {
    console.error("Could not decrypt assignment", row.id, e);
    return null;
  }
}

const shift = (days: number) => dayKey(new Date(Date.now() + days * 86_400_000));

function checkDate(v: unknown): string {
  const date = realDate(v, "The day");
  if (date < shift(-PAST_DAYS) || date > shift(FUTURE_DAYS)) throw badRequest(`Pick a day between ${PAST_DAYS} days ago and six months from now.`);
  return date;
}

/** An assignment the caller may change: only the coach it was made by. */
async function ownRow(me: UserRow, id: string): Promise<Row> {
  if (me.role === "CLIENT") throw forbidden("Only your coach can change this.");
  if (!ID_RE.test(id)) throw notFound("That workout is gone.");
  const d = await db();
  const [row] = await d.select().from(assignments).where(eq(assignments.id, id)).limit(1);
  if (!row || row.coachId !== me.id) throw notFound("That workout is gone.");
  return row;
}

/** Everything the person may see: a client's own, or a coach's own clients'. Roughly the last 100 days and the next 200. */
export async function loadAssignments(me: UserRow): Promise<Assignment[]> {
  const d = await db();
  const range = and(gte(assignments.date, shift(-LOAD_PAST_DAYS)), lte(assignments.date, shift(LOAD_FUTURE_DAYS)));
  const rows = await d
    .select()
    .from(assignments)
    .where(me.role === "CLIENT" ? and(eq(assignments.clientId, me.id), range) : and(eq(assignments.coachId, me.id), range));
  // A coach only sees assignments for people who are still their clients.
  const out = rows.map(open).filter((a): a is Assignment => a !== null);
  if (me.role === "CLIENT") return out;
  const mine = new Set((await d.select({ id: users.id }).from(users).where(and(eq(users.role, "CLIENT"), eq(users.coachId, me.id)))).map((r) => r.id));
  return out.filter((a) => mine.has(a.clientId));
}

export interface CreateInput {
  clientId?: unknown;
  templateId?: unknown;
  date?: unknown;
  note?: unknown;
  title?: unknown;
  repeatWeeks?: unknown;
}

/** Assigns a routine to a client on a day, and optionally on the same weekday for up to 12 more weeks. */
export async function createAssignments(me: UserRow, input: CreateInput): Promise<{ created: number; skipped: string[] }> {
  if (me.role === "CLIENT") throw forbidden("Only a coach can assign workouts.");
  if (typeof input.clientId !== "string" || typeof input.templateId !== "string" || !ID_RE.test(input.templateId)) throw badRequest("Pick a client and a routine.");
  const client = await loadClientFor(me, input.clientId);
  if (!client || !client.active) throw notFound("Client not found.");
  const date = checkDate(input.date);
  const note = str(input.note, "Note", { optional: true, max: 500 });
  const rw = input.repeatWeeks === undefined || input.repeatWeeks === null || input.repeatWeeks === "" ? 0 : Number(input.repeatWeeks);
  if (!Number.isInteger(rw) || rw < 0 || rw > MAX_REPEAT_WEEKS) throw badRequest(`Repeat for 0 to ${MAX_REPEAT_WEEKS} more weeks.`);
  await hit(`assign:${me.id}`, 60, 3_600_000, "You've assigned a lot of workouts this hour. Try again a little later.");

  const d = await db();
  const [trow] = await d.select().from(templates).where(eq(templates.id, input.templateId)).limit(1);
  const tpl = trow && trow.ownerId === me.id ? openTemplate(trow) : null;
  if (!tpl) throw notFound("Routine not found.");
  if (!tpl.exercises.length) throw badRequest("That routine has no exercises yet.");
  const title = str(input.title, "Title", { optional: true, max: 120 }) || tpl.name;

  const dates = weeklyDates(date, rw).filter((x) => x <= shift(FUTURE_DAYS));
  const existing = await d.select({ date: assignments.date }).from(assignments).where(and(eq(assignments.clientId, client.id), inArray(assignments.date, dates)));
  const perDay = new Map<string, number>();
  for (const e of existing) perDay.set(e.date, (perDay.get(e.date) ?? 0) + 1);
  const [{ n: total }] = await d.select({ n: count() }).from(assignments).where(eq(assignments.clientId, client.id));
  if (Number(total) + dates.length > MAX_PER_CLIENT) throw badRequest("This client has a lot of assigned workouts. Delete some old ones first.");

  const seriesId = dates.length > 1 ? `as_${randomUUID()}` : null;
  const skipped: string[] = [];
  let created = 0;
  for (const day of dates) {
    if ((perDay.get(day) ?? 0) >= MAX_PER_DAY) {
      skipped.push(day);
      continue;
    }
    const id = `as_${randomUUID()}`;
    const plan: Plan = { title, note, templateId: tpl.id, exercises: tpl.exercises };
    await d.insert(assignments).values({ id, clientId: client.id, coachId: me.id, date: day, seriesId, dataEnc: encryptJson(plan, aad(id)) });
    created++;
  }
  if (!created) throw badRequest(`That day already has ${MAX_PER_DAY} workouts.`);

  const first = dates.find((x) => !skipped.includes(x))!;
  const when = format(parseISO(first), "EEE d MMM");
  await notify(
    [client.id],
    "workout_assigned",
    { title: "New workout from your coach", body: `${title} on ${when}${created > 1 ? `, and ${created - 1} more week${created > 2 ? "s" : ""} after` : ""}.`, link: "/home", about: client.id },
    { email: false },
  );
  return { created, skipped };
}

/** Moves an assignment to another day, changes its note, or ticks it off (or un-ticks it) by hand. */
export async function updateAssignment(me: UserRow, id: string, patch: { date?: unknown; note?: unknown; doneManually?: unknown }): Promise<void> {
  const row = await ownRow(me, id);
  const a = open(row);
  if (!a) throw notFound("That workout is gone.");
  const d = await db();
  const plan: Plan = { title: a.title, note: a.note, templateId: a.templateId, exercises: a.exercises, doneManually: a.doneManually };
  let date = row.date;
  if (patch.date !== undefined) {
    date = checkDate(patch.date);
    if (date !== row.date) {
      const [{ n }] = await d.select({ n: count() }).from(assignments).where(and(eq(assignments.clientId, row.clientId), eq(assignments.date, date)));
      if (Number(n) >= MAX_PER_DAY) throw badRequest(`That day already has ${MAX_PER_DAY} workouts.`);
    }
  }
  if (patch.note !== undefined) plan.note = str(patch.note, "Note", { optional: true, max: 500 });
  if (patch.doneManually !== undefined) {
    if (typeof patch.doneManually !== "boolean") throw badRequest("Done must be true or false.");
    plan.doneManually = patch.doneManually || undefined;
  }
  await d
    .update(assignments)
    .set({ date, dataEnc: encryptJson(plan, aad(id)), updatedAt: new Date() })
    .where(and(eq(assignments.id, id), eq(assignments.coachId, me.id)));
  if (date !== row.date) {
    await notify([row.clientId], "workout_assigned", { title: "A workout was moved", body: `${a.title} is now on ${format(parseISO(date), "EEE d MMM")}.`, link: "/home", about: row.clientId }, { email: false });
  }
}

/** Copies an assignment onto other days (the same plan, not yet done). */
export async function copyAssignment(me: UserRow, id: string, rawDates: unknown): Promise<{ created: number; skipped: string[] }> {
  const row = await ownRow(me, id);
  const a = open(row);
  if (!a) throw notFound("That workout is gone.");
  if (!Array.isArray(rawDates) || rawDates.length === 0 || rawDates.length > MAX_REPEAT_WEEKS + 1) throw badRequest("Pick the days to copy it to.");
  const dates = [...new Set(rawDates.map(checkDate))];
  const d = await db();
  const existing = await d.select({ date: assignments.date }).from(assignments).where(and(eq(assignments.clientId, row.clientId), inArray(assignments.date, dates)));
  const perDay = new Map<string, number>();
  for (const e of existing) perDay.set(e.date, (perDay.get(e.date) ?? 0) + 1);
  const [{ n: total }] = await d.select({ n: count() }).from(assignments).where(eq(assignments.clientId, row.clientId));
  if (Number(total) + dates.length > MAX_PER_CLIENT) throw badRequest("This client has a lot of assigned workouts. Delete some old ones first.");
  const skipped: string[] = [];
  let created = 0;
  for (const day of dates) {
    if ((perDay.get(day) ?? 0) >= MAX_PER_DAY) {
      skipped.push(day);
      continue;
    }
    const nid = `as_${randomUUID()}`;
    const plan: Plan = { title: a.title, note: a.note, templateId: a.templateId, exercises: a.exercises };
    await d.insert(assignments).values({ id: nid, clientId: row.clientId, coachId: me.id, date: day, seriesId: null, dataEnc: encryptJson(plan, aad(nid)) });
    created++;
  }
  if (!created) throw badRequest(`Those days already have ${MAX_PER_DAY} workouts.`);
  await notify([row.clientId], "workout_assigned", { title: "New workout from your coach", body: `${a.title} on ${format(parseISO(dates.find((x) => !skipped.includes(x))!), "EEE d MMM")}${created > 1 ? ` and ${created - 1} more day${created > 2 ? "s" : ""}` : ""}.`, link: "/home", about: row.clientId }, { email: false });
  return { created, skipped };
}

/** Deletes one assignment, or this one and every later one made by the same "repeat weekly". */
export async function deleteAssignment(me: UserRow, id: string, scope: "one" | "future"): Promise<number> {
  const row = await ownRow(me, id);
  const d = await db();
  if (scope === "future" && row.seriesId) {
    const gone = await d.delete(assignments).where(and(eq(assignments.seriesId, row.seriesId), eq(assignments.coachId, me.id), gte(assignments.date, row.date))).returning({ id: assignments.id });
    return gone.length;
  }
  await d.delete(assignments).where(and(eq(assignments.id, id), eq(assignments.coachId, me.id)));
  return 1;
}

/** When a client is deleted, everything assigned to them goes too. */
export async function purgeClientAssignments(clientId: string): Promise<void> {
  const d = await db();
  await d.delete(assignments).where(eq(assignments.clientId, clientId));
}

