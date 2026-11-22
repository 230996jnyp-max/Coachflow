import "server-only";
import { randomUUID } from "node:crypto";
import { format } from "date-fns";
import { and, count, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import {
  AUTO_PER_DAY,
  cleanActions,
  cleanReply,
  decideAuto,
  fillText,
  firstNameOf,
  inQuietHours,
  isMode,
  isTone,
  MAX_TEXT,
  NUDGE_GAP_MS,
  sgDay,
  SMART_REPLIES_PER_DAY,
  TRIGGER_IDS,
  TRIGGERS,
  weekKey,
  type Action,
  type Mode,
  type Tone,
  type TriggerId,
} from "@/lib/autopilot";
import type { Workout } from "@/lib/types";
import { loadClientFor, openProfile } from "./accounts";
import { aiConfigured, groq, jsonFrom, TEXT_MODEL } from "./ai";
import { logAiUsage } from "./aiLog";
import { refundAiQuota, takeAiQuota } from "./aiQuota";
import { assignProgram } from "./programs";
import { displayName, hydrate } from "./chat";
import { pushNewMessage, storeMessages } from "./chatSend";
import { decryptJson, encryptJson } from "./crypto";
import { db, isLocalTestMode } from "./db";
import { notify } from "./groups";
import { membershipOf } from "./gymOrg";
import { badRequest, forbidden, notFound } from "./http";
import { requestPack } from "./intake";
import { isMinorRow } from "./accounts";
import { createPayLink, listPackages } from "./payments";
import { hit } from "./rateLimit";
import { listReplies } from "./savedReplies";
import { assignments, bookings, messages, paymentOrders, users, workouts, type UserRow } from "./schema";
import { autopilotEvents, autopilotRules, programs, smartReplySettings } from "./schemaFlow";
import { openWorkout, recentDoneWorkouts } from "./training";

/*
 * Autopilot for coaches: rules (one per trigger, all off until switched on), the events they produce (the activity log, the drafts waiting
 * for approval, the messages held for the morning) and smart replies. Everything personal is encrypted. See lib/autopilot.ts for the rules
 * that keep a client from being spammed.
 */

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const aadRule = (id: string) => `autopilot-rule:${id}`;
const aadEvent = (id: string) => `autopilot-event:${id}`;
const MAX_NEW_PER_RUN = 20;
const isStaff = (me: UserRow) => me.role === "OWNER" || me.role === "COACH";

export function requireCoach(me: UserRow): void {
  if (!isStaff(me)) throw forbidden("Autopilot is for coaches.");
}

/* ---------------- Rules ---------------- */
interface RuleData {
  actions: Action[];
  /** When it was last switched on: events from before then are never acted on. */
  enabledAt: string | null;
}
export interface RuleView {
  trigger: TriggerId;
  label: string;
  blurb: string;
  kind: "welcome" | "nudge";
  enabled: boolean;
  mode: Mode;
  actions: Action[];
  allowed: string[];
  vars: string[];
  saved: boolean;
}

type RuleRow = typeof autopilotRules.$inferSelect;
const openRule = (row: RuleRow): RuleData | null => {
  try {
    return decryptJson<RuleData>(row.dataEnc, aadRule(row.id));
  } catch (e) {
    console.error("Could not decrypt Autopilot rule", row.id, e);
    return null;
  }
};

export async function listRules(me: UserRow): Promise<RuleView[]> {
  requireCoach(me);
  const d = await db();
  const rows = await d.select().from(autopilotRules).where(eq(autopilotRules.ownerId, me.id));
  const byTrigger = new Map(rows.map((r) => [r.trigger, r]));
  return TRIGGER_IDS.map((t) => {
    const info = TRIGGERS[t];
    const row = byTrigger.get(t);
    const data = row ? openRule(row) : null;
    return { trigger: t, label: info.label, blurb: info.blurb, kind: info.kind, enabled: !!row?.enabled && !!data, mode: row && isMode(row.mode) ? row.mode : info.defaultMode, actions: data?.actions ?? info.defaults, allowed: info.allowed, vars: info.vars, saved: !!row };
  });
}

async function checkOwnedRefs(me: UserRow, actions: Action[]): Promise<void> {
  for (const a of actions) {
    if (a.type === "program") {
      const d = await db();
      const [p] = await d.select({ ownerId: programs.ownerId }).from(programs).where(eq(programs.id, a.programId)).limit(1);
      if (!p || p.ownerId !== me.id) throw badRequest("That program isn't one of yours.");
    }
    if (a.type === "paylink") {
      const pk = (await listPackages(me.id, true)).find((x) => x.id === a.packageId);
      if (!pk) throw badRequest("That package isn't one of yours (or it is switched off).");
    }
  }
}

/** Saves one rule: on or off, automatic or draft, and what it does. */
export async function saveRule(me: UserRow, triggerRaw: string, body: Record<string, unknown>): Promise<RuleView[]> {
  requireCoach(me);
  const trigger = TRIGGER_IDS.find((t) => t === triggerRaw);
  if (!trigger) throw notFound("That rule doesn't exist.");
  await hit(`autopilot-save:${me.id}`, 120, 3_600_000, "You've changed a lot of rules this hour. Try again a little later.");
  const d = await db();
  const [row] = await d.select().from(autopilotRules).where(and(eq(autopilotRules.ownerId, me.id), eq(autopilotRules.trigger, trigger))).limit(1);
  const cur = row ? openRule(row) : null;
  const info = TRIGGERS[trigger];
  let actions = cur?.actions ?? info.defaults;
  if (body.actions !== undefined) {
    const r = cleanActions(trigger, body.actions);
    if ("error" in r) throw badRequest(r.error);
    actions = r.actions;
  }
  await checkOwnedRefs(me, actions);
  const mode: Mode = body.mode === undefined ? (row && isMode(row.mode) ? row.mode : info.defaultMode) : isMode(body.mode) ? body.mode : (() => { throw badRequest("Choose automatic or draft."); })();
  const enabled = body.enabled === undefined ? !!row?.enabled : body.enabled === true;
  const turnedOn = enabled && !row?.enabled;
  const data: RuleData = { actions, enabledAt: turnedOn ? new Date().toISOString() : (cur?.enabledAt ?? (enabled ? new Date().toISOString() : null)) };
  if (row) {
    await d.update(autopilotRules).set({ enabled, mode, dataEnc: encryptJson(data, aadRule(row.id)), updatedAt: new Date() }).where(eq(autopilotRules.id, row.id));
  } else {
    const id = `ar_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await d.insert(autopilotRules).values({ id, ownerId: me.id, trigger, enabled, mode, dataEnc: encryptJson(data, aadRule(id)) });
  }
  return listRules(me);
}

/** Saves a rule for every trigger that has none yet, all switched off, with the suggested actions. Safe to press twice. */
export async function applyStarterPack(me: UserRow): Promise<RuleView[]> {
  requireCoach(me);
  const d = await db();
  const have = new Set((await d.select({ t: autopilotRules.trigger }).from(autopilotRules).where(eq(autopilotRules.ownerId, me.id))).map((r) => r.t));
  for (const t of TRIGGER_IDS) {
    if (have.has(t)) continue;
    const id = `ar_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const info = TRIGGERS[t];
    try {
      await d.insert(autopilotRules).values({ id, ownerId: me.id, trigger: t, enabled: false, mode: info.defaultMode, dataEnc: encryptJson({ actions: info.defaults, enabledAt: null } satisfies RuleData, aadRule(id)) });
    } catch {
      /* made by another click */
    }
  }
  return listRules(me);
}

/* ---------------- Events: the log, drafts and held messages ---------------- */
interface EventData {
  actions: Action[];
  mode: Mode;
  why: string;
  vars: Record<string, string>;
  dueAt?: string;
  note?: string;
  error?: string;
  results?: string[];
  heldBecause?: "quiet" | "cap";
}
type EventRow = typeof autopilotEvents.$inferSelect;
export type EventStatus = "DRAFT" | "HELD" | "SENT" | "APPROVED" | "DISMISSED" | "FAILED";

export interface EventView {
  id: string;
  clientId: string;
  clientName: string;
  trigger: TriggerId;
  label: string;
  status: EventStatus;
  why: string;
  /** The message that was (or will be) sent; empty when the rule sends none. */
  text: string;
  /** What else it does, in words. */
  extras: string[];
  note: string;
  error: string;
  dueAt: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const openEvent = (row: EventRow): EventData | null => {
  try {
    return decryptJson<EventData>(row.dataEnc, aadEvent(row.id));
  } catch (e) {
    console.error("Could not decrypt Autopilot event", row.id, e);
    return null;
  }
};
const msgOf = (a: Action[]) => (a.find((x) => x.type === "message") as { text: string } | undefined)?.text ?? "";
const extrasOf = (a: Action[]): string[] =>
  a.flatMap((x) => (x.type === "form" ? ["Sends the forms: " + x.kinds.map((k) => k.toLowerCase()).join(", ")] : x.type === "program" ? ["Assigns a program"] : x.type === "paylink" ? ["Adds a pay link"] : x.type === "alert" ? ["Alerts you"] : []));

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const d = await db();
  for (const r of await d.select().from(users).where(inArray(users.id, [...new Set(ids)]))) out.set(r.id, displayName(r));
  return out;
}

async function toViews(rows: EventRow[], includeText = true): Promise<EventView[]> {
  const names = await namesFor(rows.map((r) => r.clientId));
  const out: EventView[] = [];
  for (const r of rows) {
    const data = openEvent(r);
    if (!data || !(r.trigger in TRIGGERS)) continue;
    const trigger = r.trigger as TriggerId;
    out.push({
      id: r.id,
      clientId: r.clientId,
      clientName: names.get(r.clientId) ?? "A former client",
      trigger,
      label: TRIGGERS[trigger].label,
      status: r.status as EventStatus,
      why: data.why,
      text: includeText ? fillText(msgOf(data.actions), data.vars).replace("{pay_link}", "[pay link]") : "",
      extras: extrasOf(data.actions),
      note: data.note ?? "",
      error: data.error ?? "",
      dueAt: data.dueAt ?? null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    });
  }
  return out;
}

export async function listEvents(me: UserRow, opts: { status?: string[]; clientId?: string; limit?: number } = {}): Promise<EventView[]> {
  requireCoach(me);
  const d = await db();
  const conds = [eq(autopilotEvents.ownerId, me.id)];
  if (opts.status?.length) conds.push(inArray(autopilotEvents.status, opts.status));
  if (opts.clientId) conds.push(eq(autopilotEvents.clientId, opts.clientId));
  const rows = await d.select().from(autopilotEvents).where(and(...conds)).orderBy(desc(autopilotEvents.createdAt)).limit(Math.min(opts.limit ?? 60, 200));
  return toViews(rows);
}

/** What the gym's managers may see about their coaches' Autopilot: what ran, for whom and when. Never the messages themselves, and no rules. */
export async function teamLog(me: UserRow): Promise<{ coaches: { id: string; name: string }[]; events: (EventView & { coachId: string; coachName: string })[] }> {
  const m = await membershipOf(me.id);
  if (!m || m.perms.length === 0 || m.gym.status !== "ACTIVE") throw forbidden("Only a gym manager can see the team's Autopilot.");
  const d = await db();
  const { gymMembers } = await import("./schema");
  const members = await d.select({ userId: gymMembers.userId }).from(gymMembers).where(and(eq(gymMembers.gymId, m.gym.id), eq(gymMembers.status, "ACTIVE")));
  const ids = members.map((x) => x.userId).filter((x) => x !== me.id);
  if (ids.length === 0) return { coaches: [], events: [] };
  const names = await namesFor(ids);
  const rows = await d.select().from(autopilotEvents).where(inArray(autopilotEvents.ownerId, ids)).orderBy(desc(autopilotEvents.createdAt)).limit(100);
  const views = await toViews(rows, false);
  const ownerOf = new Map(rows.map((r) => [r.id, r.ownerId]));
  return {
    coaches: ids.map((id) => ({ id, name: names.get(id) ?? "Coach" })),
    events: views.map((v) => ({ ...v, extras: v.extras, why: v.why, coachId: ownerOf.get(v.id) ?? "", coachName: names.get(ownerOf.get(v.id) ?? "") ?? "Coach" })),
  };
}

/* ---------------- Doing it ---------------- */
const originOf = (origin?: string) => origin || process.env.APP_URL || "https://coachflow.pro";
const addDays = (day: string, n: number) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n)).toISOString().slice(0, 10);

/** Runs the actions of one event. Never throws: the result says what happened. */
async function execute(owner: UserRow, clientId: string, data: EventData, kind: "welcome" | "nudge", origin?: string): Promise<{ ok: boolean; skipped?: string; results: string[]; error?: string }> {
  const results: string[] = [];
  const errors: string[] = [];
  const vars = { ...data.vars };
  const ordered = [...data.actions].sort((a, b) => (a.type === "paylink" ? -1 : b.type === "paylink" ? 1 : 0));
  for (const a of ordered) {
    try {
      if (a.type === "paylink") {
        const r = await createPayLink(owner, clientId, a.packageId);
        vars.pay_link = `${originOf(origin)}${r.path}`;
        results.push("Made a pay link");
      } else if (a.type === "message") {
        if (kind === "nudge") {
          try {
            await hit(`nudge-to:${owner.id}:${clientId}`, 1, NUDGE_GAP_MS);
          } catch {
            return { ok: false, skipped: "They were nudged in the last 6 hours, so this was not sent.", results };
          }
        }
        const text = fillText(a.text, vars).slice(0, 2000);
        if (/\{pay_link\}/.test(text)) throw new Error("The pay link could not be made.");
        await storeMessages([{ thread: `c:${clientId}`, text, email: { status: "off" } }], owner);
        pushNewMessage(owner, [clientId], `c:${clientId}`);
        results.push("Sent the message");
      } else if (a.type === "form") {
        await requestPack(owner, clientId, a.kinds);
        results.push("Asked for the forms");
      } else if (a.type === "program") {
        const start = addDays(sgDay(new Date()), a.startInDays);
        await assignProgram(owner, a.programId, { clientId, startDate: start, liveSync: true });
        results.push("Assigned the program");
      } else if (a.type === "alert") {
        await notify([owner.id], "autopilot_alert", { title: "Autopilot", body: fillText(a.text, vars), link: `/clients/${clientId}`, about: clientId }, { email: false });
        results.push("Alerted you");
      }
    } catch (e) {
      errors.push(`${a.type}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return { ok: errors.length === 0, results, ...(errors.length ? { error: errors.join(" · ").slice(0, 300) } : {}) };
}

async function sentTodayCount(ownerId: string, clientId: string, now: Date): Promise<number> {
  const d = await db();
  const dayStart = new Date(`${sgDay(now)}T00:00:00+08:00`);
  const [{ n }] = await d.select({ n: count() }).from(autopilotEvents).where(and(eq(autopilotEvents.ownerId, ownerId), eq(autopilotEvents.clientId, clientId), eq(autopilotEvents.status, "SENT"), gte(autopilotEvents.decidedAt, dayStart)));
  return Number(n);
}

async function finish(row: EventRow, data: EventData, status: EventStatus, res: { results: string[]; error?: string; skipped?: string }, at: Date = new Date()): Promise<void> {
  const d = await db();
  const next: EventData = { ...data, results: res.results, ...(res.error ? { error: res.error } : {}), ...(res.skipped ? { note: res.skipped } : {}) };
  await d.update(autopilotEvents).set({ status, dataEnc: encryptJson(next, aadEvent(row.id)), decidedAt: at }).where(eq(autopilotEvents.id, row.id));
}

async function ownerRow(id: string): Promise<UserRow | null> {
  const d = await db();
  const [u] = await d.select().from(users).where(and(eq(users.id, id), eq(users.active, true))).limit(1);
  return u ?? null;
}

/** Sends (or holds, or drafts) one new event according to its rule's mode. */
async function dispatch(owner: UserRow, rule: { mode: Mode }, row: EventRow, data: EventData, now: Date, origin?: string): Promise<"sent" | "held" | "draft" | "dismissed" | "failed"> {
  if (rule.mode === "draft") return "draft";
  const kind = TRIGGERS[row.trigger as TriggerId].kind;
  const decision = decideAuto(now, await sentTodayCount(owner.id, row.clientId, now));
  if (!decision.send) {
    const d = await db();
    const held: EventData = { ...data, dueAt: decision.hold.toISOString(), heldBecause: decision.why };
    await d.update(autopilotEvents).set({ status: "HELD", dataEnc: encryptJson(held, aadEvent(row.id)) }).where(eq(autopilotEvents.id, row.id));
    return "held";
  }
  const res = await execute(owner, row.clientId, data, kind, origin);
  if (res.skipped) {
    await finish(row, data, "DISMISSED", res, now);
    return "dismissed";
  }
  await finish(row, data, res.ok ? "SENT" : "FAILED", res, now);
  return res.ok ? "sent" : "failed";
}

/* ---------------- Finding what happened ---------------- */
interface Candidate {
  clientId: string;
  key: string;
  vars: Record<string, string>;
  why: string;
}
interface ClientCtx {
  row: UserRow;
  name: string;
  profile: ReturnType<typeof openProfile>;
}
interface Ctx {
  owner: UserRow;
  clients: ClientCtx[];
  since: Date;
  now: Date;
}

const DAY = 86_400_000;

async function recentWorkouts(ctx: Ctx, cutoff: Date): Promise<Workout[]> {
  if (ctx.clients.length === 0) return [];
  const d = await db();
  const rows = await d.select().from(workouts).where(and(inArray(workouts.clientId, ctx.clients.map((c) => c.row.id)), eq(workouts.status, "DONE"), gte(workouts.updatedAt, cutoff)));
  return rows.map(openWorkout).filter((w): w is Workout => w !== null);
}

const DETECT: Record<TriggerId, (ctx: Ctx) => Promise<Candidate[]>> = {
  async client_joined(ctx) {
    return ctx.clients.filter((c) => c.row.createdAt >= ctx.since).map((c) => ({ clientId: c.row.id, key: c.row.id, vars: {}, why: "They became your client." }));
  },
  async package_bought(ctx) {
    const d = await db();
    const ids = ctx.clients.map((c) => c.row.id);
    if (!ids.length) return [];
    const rows = await d.select().from(paymentOrders).where(and(eq(paymentOrders.coachId, ctx.owner.id), inArray(paymentOrders.clientId, ids), eq(paymentOrders.status, "PAID"), gte(paymentOrders.paidAt, ctx.since)));
    return rows.map((o) => ({ clientId: o.clientId, key: o.id, vars: { package: o.name }, why: `They paid for “${o.name}”.` }));
  },
  async first_session_booked(ctx) {
    const d = await db();
    const ids = ctx.clients.map((c) => c.row.id);
    if (!ids.length) return [];
    const fresh = await d.select().from(bookings).where(and(inArray(bookings.clientId, ids), gte(bookings.createdAt, ctx.since)));
    const out: Candidate[] = [];
    for (const b of fresh.filter((x) => x.status !== "CANCELLED" && x.status !== "DECLINED").sort((a, c) => a.createdAt.getTime() - c.createdAt.getTime())) {
      if (out.some((o) => o.clientId === b.clientId)) continue;
      const [{ n }] = await d.select({ n: count() }).from(bookings).where(and(eq(bookings.clientId, b.clientId), lt(bookings.createdAt, b.createdAt)));
      if (Number(n) === 0) out.push({ clientId: b.clientId, key: b.id, vars: { session_date: format(b.startAt, "EEE d MMM") }, why: "It is their first booking with you." });
    }
    return out;
  },
  async session_completed(ctx) {
    const d = await db();
    const ids = ctx.clients.map((c) => c.row.id);
    if (!ids.length) return [];
    const from = new Date(Math.max(ctx.since.getTime(), ctx.now.getTime() - 3 * DAY));
    const rows = await d.select().from(bookings).where(and(inArray(bookings.clientId, ids), eq(bookings.status, "COMPLETED"), gte(bookings.startAt, from), lte(bookings.startAt, ctx.now)));
    return rows.map((b) => ({ clientId: b.clientId, key: b.id, vars: {}, why: `Session on ${format(b.startAt, "EEE d MMM")} was completed.` }));
  },
  async missed_two_workouts(ctx) {
    const d = await db();
    const today = sgDay(ctx.now);
    const rows = await d.select().from(assignments).where(and(eq(assignments.coachId, ctx.owner.id), gte(assignments.date, addDays(today, -7)), lte(assignments.date, addDays(today, -1))));
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.clientId, [...(by.get(r.clientId) ?? []), r]);
    const out: Candidate[] = [];
    for (const c of ctx.clients) {
      const mine = by.get(c.row.id);
      if (!mine || mine.length < 2 || c.row.createdAt.getTime() > ctx.now.getTime() - 7 * DAY) continue;
      const done = new Set((await recentDoneWorkouts(c.row.id, 40)).map((w) => w.assignmentId).filter(Boolean));
      const { openPlan } = await import("./assignments");
      const missed = mine.filter((a) => !done.has(a.id) && !openPlan(a)?.doneManually).length;
      if (missed >= 2) out.push({ clientId: c.row.id, key: weekKey(ctx.now), vars: { missed: String(missed) }, why: `${missed} assigned workouts were missed in the last 7 days.` });
    }
    return out;
  },
  async no_workout_7d(ctx) {
    const d = await db();
    const ids = ctx.clients.map((c) => c.row.id);
    if (!ids.length) return [];
    const last = await d.select({ clientId: workouts.clientId, at: sql<Date>`max(${workouts.startedAt})` }).from(workouts).where(and(inArray(workouts.clientId, ids), eq(workouts.status, "DONE"))).groupBy(workouts.clientId);
    const lastBy = new Map(last.map((l) => [l.clientId, new Date(l.at)]));
    const out: Candidate[] = [];
    for (const c of ctx.clients) {
      if (c.row.createdAt.getTime() > ctx.now.getTime() - 7 * DAY) continue;
      const at = lastBy.get(c.row.id);
      const days = at ? Math.floor((ctx.now.getTime() - at.getTime()) / DAY) : Math.floor((ctx.now.getTime() - c.row.createdAt.getTime()) / DAY);
      if (days >= 7) out.push({ clientId: c.row.id, key: at ? sgDay(at) : "never", vars: { days: String(days) }, why: at ? `No finished workout for ${days} days.` : "They have not finished a workout yet." });
    }
    return out;
  },
  async one_credit_left(ctx) {
    return ctx.clients
      .filter((c) => c.profile.credits === 1 && c.profile.packageSize > 0)
      .map((c) => ({ clientId: c.row.id, key: `c1:${c.profile.packageSize}:${sgDay(ctx.now).slice(0, 7)}`, vars: {}, why: "They have 1 session left in their package." }));
  },
  async package_ending(ctx) {
    const today = sgDay(ctx.now);
    return ctx.clients
      .filter((c) => c.profile.packageExpires && c.profile.packageExpires >= today && c.profile.packageExpires <= addDays(today, 7) && c.profile.credits + (c.profile.groupClassCredits ?? 0) > 0)
      .map((c) => ({ clientId: c.row.id, key: c.profile.packageExpires ?? "", vars: { expiry_date: format(new Date(`${c.profile.packageExpires}T00:00:00`), "EEE d MMM") }, why: `Their package ends on ${c.profile.packageExpires} with sessions left.` }));
  },
  async new_pb(ctx) {
    const from = new Date(Math.max(ctx.since.getTime(), ctx.now.getTime() - 3 * DAY));
    return (await recentWorkouts(ctx, from))
      .filter((w) => w.exercises.some((e) => e.sets.some((s) => s.done && s.pr?.length)))
      .map((w) => ({ clientId: w.clientId, key: w.id, vars: {}, why: `A new personal best in “${w.title || "a workout"}”.` }));
  },
  async pain_high(ctx) {
    const from = new Date(Math.max(ctx.since.getTime(), ctx.now.getTime() - 3 * DAY));
    return (await recentWorkouts(ctx, from))
      .filter((w) => typeof w.feedback?.pain === "number" && w.feedback.pain >= 6)
      .map((w) => ({ clientId: w.clientId, key: w.id, vars: {}, why: `They rated their pain ${w.feedback?.pain} out of 10 after “${w.title || "a workout"}”.` }));
  },
};

export interface RunResult {
  created: number;
  sent: number;
  held: number;
  drafts: number;
  released: number;
}

/** Looks for new events for one coach's enabled rules and sends, holds or drafts each (at most 20 new ones a run). */
export async function runForCoach(owner: UserRow, opts: { now?: Date; origin?: string } = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const result: RunResult = { created: 0, sent: 0, held: 0, drafts: 0, released: 0 };
  const d = await db();
  result.released = await releaseHeld(owner, now, opts.origin);
  const rules = (await d.select().from(autopilotRules).where(and(eq(autopilotRules.ownerId, owner.id), eq(autopilotRules.enabled, true)))).filter((r) => r.trigger in TRIGGERS);
  if (rules.length === 0) return result;
  const clientRows = await d.select().from(users).where(and(eq(users.role, "CLIENT"), eq(users.coachId, owner.id), eq(users.active, true)));
  const clients: ClientCtx[] = [];
  for (const row of clientRows) {
    try {
      const profile = openProfile(row);
      if ((profile as { archived?: boolean }).archived) continue;
      clients.push({ row, name: displayName(row), profile });
    } catch {
      /* unreadable profile */
    }
  }
  if (clients.length === 0) return result;
  const names = new Map(clients.map((c) => [c.row.id, c.name]));
  let budget = MAX_NEW_PER_RUN;
  for (const rule of rules) {
    if (budget <= 0) break;
    const data = openRule(rule);
    if (!data || !data.actions.length) continue;
    const trigger = rule.trigger as TriggerId;
    const since = data.enabledAt ? new Date(data.enabledAt) : now;
    let found: Candidate[] = [];
    try {
      found = await DETECT[trigger]({ owner, clients, since, now });
    } catch (e) {
      console.error("Autopilot detect failed", trigger, e instanceof Error ? e.message : e);
      continue;
    }
    for (const c of found) {
      if (budget <= 0) break;
      const first = firstNameOf(names.get(c.clientId) ?? "");
      const vars = { first_name: first, coach_name: firstNameOf(displayName(owner)), ...c.vars };
      const ev: EventData = { actions: data.actions, mode: isMode(rule.mode) ? rule.mode : "draft", why: c.why, vars };
      const id = `ae_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const inserted = await d
        .insert(autopilotEvents)
        .values({ id, ownerId: owner.id, clientId: c.clientId, trigger, eventKey: c.key, status: ev.mode === "draft" ? "DRAFT" : "SENT", dataEnc: encryptJson(ev, aadEvent(id)) })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) continue; // this event was already handled
      budget--;
      result.created++;
      const outcome = await dispatch(owner, { mode: ev.mode }, inserted[0], ev, now, opts.origin);
      if (outcome === "sent") result.sent++;
      else if (outcome === "held") result.held++;
      else if (outcome === "draft") result.drafts++;
    }
  }
  return result;
}

/** Lets go the messages held for the morning (or for the daily limit) once it is allowed. Returns how many went out. */
export async function releaseHeld(owner: UserRow, now = new Date(), origin?: string): Promise<number> {
  if (inQuietHours(now)) return 0;
  const d = await db();
  const rows = await d.select().from(autopilotEvents).where(and(eq(autopilotEvents.ownerId, owner.id), eq(autopilotEvents.status, "HELD"))).orderBy(autopilotEvents.createdAt).limit(40);
  let released = 0;
  for (const row of rows) {
    const data = openEvent(row);
    if (!data || !(row.trigger in TRIGGERS)) continue;
    if (data.dueAt && new Date(data.dueAt).getTime() > now.getTime()) continue;
    if ((await sentTodayCount(owner.id, row.clientId, now)) >= AUTO_PER_DAY) continue;
    const res = await execute(owner, row.clientId, data, TRIGGERS[row.trigger as TriggerId].kind, origin);
    if (res.skipped) await finish(row, data, "DISMISSED", res, now);
    else {
      await finish(row, data, res.ok ? "SENT" : "FAILED", res, now);
      if (res.ok) released++;
    }
  }
  return released;
}

/** The daily job for every coach with a rule switched on (also lets go what was held overnight). */
export async function runAll(now = new Date(), origin?: string): Promise<{ coaches: number; created: number; sent: number; released: number }> {
  const d = await db();
  const owners = await d.selectDistinct({ ownerId: autopilotRules.ownerId }).from(autopilotRules).where(eq(autopilotRules.enabled, true));
  const t = { coaches: 0, created: 0, sent: 0, released: 0 };
  for (const o of owners) {
    const u = await ownerRow(o.ownerId);
    if (!u || !isStaff(u)) continue;
    try {
      const r = await runForCoach(u, { now, origin });
      t.coaches++;
      t.created += r.created;
      t.sent += r.sent;
      t.released += r.released;
    } catch (e) {
      console.error("Autopilot run failed for", o.ownerId, e instanceof Error ? e.message : e);
    }
  }
  return t;
}

/** Called when a coach opens their dashboard: runs their rules, at most once every 10 minutes, so a new client is welcomed soon after they join. */
export async function tick(me: UserRow, origin?: string): Promise<RunResult | null> {
  requireCoach(me);
  try {
    await hit(`autopilot-tick:${me.id}`, 1, 10 * 60_000);
  } catch {
    return null;
  }
  return runForCoach(me, { origin });
}

/** Run it now (the coach pressed the button), at most 6 times an hour. */
export async function runNow(me: UserRow, origin?: string): Promise<RunResult> {
  requireCoach(me);
  await hit(`autopilot-now:${me.id}`, 6, 3_600_000, "You've checked a lot this hour. Try again a little later.");
  return runForCoach(me, { origin });
}

/** Send or dismiss a draft (or a held message). Sending can use edited words. */
export async function decideEvent(me: UserRow, id: string, body: Record<string, unknown>, origin?: string): Promise<{ status: EventStatus; error?: string; note?: string }> {
  requireCoach(me);
  if (!ID_RE.test(id)) throw notFound("That draft is gone.");
  const d = await db();
  const [row] = await d.select().from(autopilotEvents).where(eq(autopilotEvents.id, id)).limit(1);
  if (!row || row.ownerId !== me.id || (row.status !== "DRAFT" && row.status !== "HELD") || !(row.trigger in TRIGGERS)) throw notFound("That draft is gone.");
  const data = openEvent(row);
  if (!data) throw notFound("That draft is gone.");
  if (body.action === "dismiss") {
    await finish(row, data, "DISMISSED", { results: [] });
    return { status: "DISMISSED" };
  }
  if (body.action !== "send") throw badRequest("Choose send or dismiss.");
  const client = await loadClientFor(me, row.clientId);
  if (!client || !client.active || client.coachId !== me.id) throw notFound("That client is no longer yours.");
  let next = data;
  if (typeof body.text === "string") {
    const text = body.text.replace(/\r/g, "").trim().slice(0, MAX_TEXT);
    if (!text) throw badRequest("The message can't be empty.");
    next = { ...data, actions: data.actions.map((a) => (a.type === "message" ? { ...a, text } : a)) };
  }
  const res = await execute(me, row.clientId, next, TRIGGERS[row.trigger as TriggerId].kind, origin);
  if (res.skipped) {
    // The coach chose to send it: a manual send is never blocked by the nudge gap, so say it and let them decide.
    throw badRequest(res.skipped + " Wait a little, or message them yourself.");
  }
  await finish(row, next, res.ok ? "APPROVED" : "FAILED", res);
  return { status: res.ok ? "APPROVED" : "FAILED", ...(res.error ? { error: res.error } : {}) };
}

/* ---------------- Smart replies ---------------- */
const aiOn = (): boolean => aiConfigured() && !(isLocalTestMode() && (process.env.AI_TRAINER_DISABLE === "1" || process.env.PROGRAMS_AI_DISABLE === "1"));
export const smartAiAvailable = aiOn;

export async function smartSettings(me: UserRow): Promise<{ enabled: boolean; tone: Tone; aiAvailable: boolean; perDay: number }> {
  requireCoach(me);
  const d = await db();
  const [row] = await d.select().from(smartReplySettings).where(eq(smartReplySettings.ownerId, me.id)).limit(1);
  return { enabled: !!row?.enabled, tone: row && isTone(row.tone) ? row.tone : "casual", aiAvailable: aiOn(), perDay: SMART_REPLIES_PER_DAY };
}

export async function saveSmartSettings(me: UserRow, body: Record<string, unknown>) {
  requireCoach(me);
  const cur = await smartSettings(me);
  const enabled = body.enabled === undefined ? cur.enabled : body.enabled === true;
  const tone = body.tone === undefined ? cur.tone : isTone(body.tone) ? body.tone : (() => { throw badRequest("Choose a tone."); })();
  const d = await db();
  await d.insert(smartReplySettings).values({ ownerId: me.id, enabled, tone }).onConflictDoUpdate({ target: smartReplySettings.ownerId, set: { enabled, tone, updatedAt: new Date() } });
  return smartSettings(me);
}

const REPLY_SYSTEM = `You help a personal trainer reply to a client in the chat. Write ONE short reply (1 to 3 sentences, at most one emoji) in the trainer's own voice, in the requested TONE, in the style of the STYLE EXAMPLES. Use only the FACTS and the conversation: never invent sessions, numbers or promises, never give medical advice or diagnose (if they mention pain or an injury, show care and ask them to tell you more, or suggest they see a doctor if it is serious). Do not sign off with a name. Answer ONLY with JSON: {"reply":"<the reply>"}.`;

/** Drafts a reply for the coach to edit and send. Never sent by itself. */
export async function draftReply(me: UserRow, threadRaw: unknown): Promise<{ text: string }> {
  requireCoach(me);
  const settings = await smartSettings(me);
  if (!settings.enabled) throw badRequest("Switch on smart replies in Autopilot first.");
  const thread = typeof threadRaw === "string" ? threadRaw : "";
  if (!/^c:[A-Za-z0-9_.-]{1,80}$/.test(thread)) throw badRequest("Smart replies are for your clients' chats.");
  const client = await loadClientFor(me, thread.slice(2));
  if (!client || !client.active || client.coachId !== me.id) throw notFound("Client not found.");
  if (isMinorRow(client)) throw forbidden("Smart replies aren't used for clients under 18.");
  if (!aiOn()) throw badRequest("The AI is not available right now. You can still use your saved replies.");
  await takeAiQuota(me.id, "smart_reply", SMART_REPLIES_PER_DAY, "smart replies");
  const d = await db();
  try {
    const rows = await d.select().from(messages).where(eq(messages.thread, thread)).orderBy(desc(messages.createdAt)).limit(8);
    const convo = (await hydrate(rows.reverse(), me.id)).filter((m) => !m.broadcast);
    if (convo.length === 0) throw badRequest("There is nothing to reply to yet.");
    const first = firstNameOf(displayName(client));
    const p = openProfile(client);
    const last = (await recentDoneWorkouts(client.id, 1))[0];
    const [next] = await d.select({ startAt: bookings.startAt }).from(bookings).where(and(eq(bookings.clientId, client.id), eq(bookings.status, "CONFIRMED"), gte(bookings.startAt, new Date()))).orderBy(bookings.startAt).limit(1);
    const facts = [
      "The client's name is not given to you: write {first_name} wherever the reply should use it.",
      `Sessions left in their package: ${p.credits}`,
      last ? `Last finished workout: “${last.title || "a workout"}” on ${format(new Date(last.startedAt), "EEE d MMM")}${typeof last.feedback?.pain === "number" ? `, pain ${last.feedback.pain}/10` : ""}` : "No finished workouts yet",
      next ? `Next session: ${format(next.startAt, "EEE d MMM h:mm a")}` : "No session booked",
    ];
    const styles = (await listReplies(me)).slice(0, 4).map((r) => `- ${r.text}`);
    const content = await groq(
      {
        model: TEXT_MODEL,
        temperature: 0.5,
        reasoning_effort: "low",
        max_completion_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: REPLY_SYSTEM },
          {
            role: "user",
            content: [`TONE: ${settings.tone}`, "FACTS:", ...facts, "STYLE EXAMPLES:", ...(styles.length ? styles : ["- (none yet)"]), "CONVERSATION (oldest first):", ...convo.map((m) => `${m.fromId === me.id ? "Trainer" : "Client"}: ${m.text.slice(0, 400)}`)].join(String.fromCharCode(10)),
          },
        ],
      },
      30_000,
    );
    // The name was never sent to the AI; it is put in here, on our side.
    const text = cleanReply((jsonFrom(content) as { reply?: unknown })?.reply).replaceAll("{first_name}", first);
    if (!text) throw badRequest("The AI didn't write a reply. Try again.");
    await logAiUsage({ userId: me.id, feature: "other" });
    return { text };
  } catch (e) {
    await refundAiQuota(me.id, "smart_reply");
    throw e;
  }
}

/** When a client is deleted, their Autopilot history goes too. */
export async function purgeClientAutopilot(clientId: string): Promise<void> {
  const d = await db();
  await d.delete(autopilotEvents).where(eq(autopilotEvents.clientId, clientId));
}
