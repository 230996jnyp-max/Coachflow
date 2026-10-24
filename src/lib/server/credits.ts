import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { AttendanceInfo, AttendanceStats, CreditLogEntry } from "@/lib/types";
import { openProfile } from "./accounts";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { adjustCredits, adjustGroupCredits } from "./schedule";
import { attendance, bookings, creditLog, users, type AttendanceRow } from "./schema";

/*
 * Attendance and the credit log.
 *  - Credits are *reserved* when a session is booked and only *taken* when the client is marked Present (or marked
 *    No-Show with the coach's "deduct anyway" override). A plain No-Show gives the credit back.
 *  - Each person in each session has one attendance row with a `charged` flag. A mark is applied by comparing the wanted
 *    charge with what is already charged, so switching Present <-> No-Show <-> Present never double-counts.
 */

export type Pool = "SESSION" | "GROUP";
export type Mark = "PRESENT" | "NO_SHOW";
export type SessionKind = "BOOKING" | "GROUP";
export type LogKind = "RESERVED" | "ATTENDED" | "NOSHOW_RETURNED" | "NOSHOW_DEDUCTED" | "CORRECTION" | "ADJUSTMENT" | "OPENING";

export const attKey = (kind: SessionKind, sessionId: string, clientId: string) => `${kind}:${sessionId}:${clientId}`;
const aadL = (id: string) => `creditlog:${id}`;

export async function balanceOf(clientId: string, pool: Pool): Promise<number> {
  const d = await db();
  const [row] = await d.select().from(users).where(eq(users.id, clientId)).limit(1);
  if (!row) return 0;
  const p = openProfile(row);
  return pool === "GROUP" ? (p.groupClassCredits ?? 0) : p.credits;
}

interface LogData {
  sessionType: string;
  label: string;
  delta: number;
  balance: number;
  note?: string;
}

/** Appends a line to a client's credit log. `balance` is read after the change, so call this after adjusting credits. */
export async function logCredit(i: { clientId: string; coachId: string; pool: Pool; kind: LogKind; delta: number; sessionType?: string; label: string; note?: string; balance?: number }): Promise<void> {
  try {
    const d = await db();
    const id = `cl_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const data: LogData = { sessionType: i.sessionType ?? "", label: i.label, delta: i.delta, balance: i.balance ?? (await balanceOf(i.clientId, i.pool)), ...(i.note ? { note: i.note } : {}) };
    await d.insert(creditLog).values({ id, clientId: i.clientId, coachId: i.coachId, pool: i.pool, kind: i.kind, dataEnc: encryptJson(data, aadL(id)) });
  } catch (e) {
    console.error("credit log failed", e);
  }
}

export async function loadCreditLog(clientId: string): Promise<CreditLogEntry[]> {
  const d = await db();
  const rows = await d.select().from(creditLog).where(eq(creditLog.clientId, clientId)).orderBy(desc(creditLog.createdAt)).limit(300);
  const out: CreditLogEntry[] = [];
  for (const r of rows) {
    try {
      const x = decryptJson<LogData>(r.dataEnc, aadL(r.id));
      out.push({ id: r.id, at: r.createdAt.toISOString(), pool: r.pool as Pool, kind: r.kind, sessionType: x.sessionType, label: x.label, delta: x.delta, balance: x.balance, note: x.note });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

export const attendanceInfo = (r?: AttendanceRow | null): AttendanceInfo | undefined => (r ? { mark: r.mark as Mark, deduct: r.mark === "NO_SHOW" && r.charged } : undefined);

/** All attendance rows for the given sessions (one query), keyed by `<kind>:<sessionId>:<clientId>`. */
export async function attendanceFor(kind: SessionKind, sessionIds: string[]): Promise<Map<string, AttendanceRow>> {
  const out = new Map<string, AttendanceRow>();
  if (!sessionIds.length) return out;
  const d = await db();
  const rows = await d.select().from(attendance).where(and(eq(attendance.kind, kind), inArray(attendance.sessionId, sessionIds)));
  for (const r of rows) out.set(r.id, r);
  return out;
}

export interface SetMarkInput {
  kind: SessionKind;
  sessionId: string;
  coachId: string;
  clientId: string;
  pool: Pool;
  /** CLEAR removes the mark (a charged credit is returned). */
  mark: Mark | "CLEAR";
  /** Only for NO_SHOW: take the credit anyway (the coach's override). */
  deduct?: boolean;
  sessionType: string;
  label: string;
  /** Sessions finished before attendance existed already took their credit: continue from that state. */
  legacy?: { mark: Mark; charged: boolean };
}

export interface SetMarkResult {
  changed: boolean;
  prevMark: Mark | null;
  mark: Mark | null;
  prevCharged: boolean;
  charged: boolean;
}

/** Applies one attendance mark and settles the credit. Safe to repeat: it only ever moves the balance by the difference. */
export async function setMark(i: SetMarkInput): Promise<SetMarkResult> {
  const d = await db();
  const id = attKey(i.kind, i.sessionId, i.clientId);
  const [rec] = await d.select().from(attendance).where(eq(attendance.id, id)).limit(1);
  const prevMark = (rec?.mark as Mark | undefined) ?? i.legacy?.mark ?? null;
  const prevCharged = rec ? rec.charged : (i.legacy?.charged ?? false);
  const nextMark: Mark | null = i.mark === "CLEAR" ? null : i.mark;
  const wantCharged = nextMark === "PRESENT" || (nextMark === "NO_SHOW" && i.deduct === true);
  const changed = prevMark !== nextMark || prevCharged !== wantCharged || !rec !== !nextMark;

  const delta = (wantCharged ? 1 : 0) - (prevCharged ? 1 : 0); // credits taken (+) or given back (-)
  if (delta !== 0) {
    const [row] = await d.select().from(users).where(eq(users.id, i.clientId)).limit(1);
    if (row) {
      if (i.pool === "GROUP") await adjustGroupCredits(row, -delta);
      else await adjustCredits(row, -delta);
    }
  }

  if (nextMark === null) {
    if (rec) await d.delete(attendance).where(eq(attendance.id, id));
  } else {
    await d
      .insert(attendance)
      .values({ id, kind: i.kind, sessionId: i.sessionId, clientId: i.clientId, coachId: i.coachId, pool: i.pool, mark: nextMark, charged: wantCharged })
      .onConflictDoUpdate({ target: attendance.id, set: { mark: nextMark, charged: wantCharged, pool: i.pool, markedAt: new Date() } });
  }

  if (changed && (prevMark !== nextMark || prevCharged !== wantCharged)) {
    let kind: LogKind;
    let note: string | undefined;
    if (nextMark === "PRESENT") kind = "ATTENDED";
    else if (nextMark === "NO_SHOW") kind = wantCharged ? "NOSHOW_DEDUCTED" : "NOSHOW_RETURNED";
    else {
      kind = "CORRECTION";
      note = "Attendance cleared";
    }
    if (prevMark && nextMark && prevMark !== nextMark) note = "Changed from " + (prevMark === "PRESENT" ? "Present" : "No-Show");
    await logCredit({ clientId: i.clientId, coachId: i.coachId, pool: i.pool, kind, delta: -delta, sessionType: i.sessionType, label: i.label, note });
  }
  return { changed, prevMark, mark: nextMark, prevCharged, charged: wantCharged };
}

/** Marks that currently use or release credit for these clients are not "reserved" any more. */
export async function markedSessionIds(kind: SessionKind, clientId: string): Promise<Set<string>> {
  const d = await db();
  const rows = await d.select({ sessionId: attendance.sessionId }).from(attendance).where(and(eq(attendance.clientId, clientId), eq(attendance.kind, kind)));
  return new Set(rows.map((r) => r.sessionId));
}

/** Present / No-Show totals across 1-on-1 and group sessions (older completed and no-show sessions count too). */
export async function attendanceStats(clientId: string): Promise<AttendanceStats> {
  const d = await db();
  const recs = await d.select().from(attendance).where(eq(attendance.clientId, clientId));
  let present = recs.filter((r) => r.mark === "PRESENT").length;
  let noShow = recs.filter((r) => r.mark === "NO_SHOW").length;
  const marked = recs.filter((r) => r.kind === "BOOKING").map((r) => r.sessionId);
  const legacy = await d
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(marked.length ? and(eq(bookings.clientId, clientId), inArray(bookings.status, ["COMPLETED", "NO_SHOW"]), notInArray(bookings.id, marked)) : and(eq(bookings.clientId, clientId), inArray(bookings.status, ["COMPLETED", "NO_SHOW"])));
  for (const b of legacy) {
    if (b.status === "COMPLETED") present++;
    else noShow++;
  }
  const total = present + noShow;
  return { present, noShow, rate: total ? Math.round((present / total) * 100) : null };
}
