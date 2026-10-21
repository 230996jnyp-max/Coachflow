import "server-only";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { AvailabilitySlot, Booking, BookingStatus, GymLocation, Role, SessionFocus } from "@/lib/types";
import { openProfile, sealProfile } from "./accounts";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { bookings, coachSettings, gyms, slots, users, type BookingRow, type UserRow } from "./schema";

export interface Rules {
  sessionMinutes: number;
  noticeHours: number;
  autoConfirm: boolean;
  allowCustomGym: boolean;
  /** Coach's UTC offset in minutes (Singapore = 480); positions availability windows. */
  utcOffsetMin: number;
}

export const DEFAULT_RULES: Rules = { sessionMinutes: 60, noticeHours: 12, autoConfirm: true, allowCustomGym: true, utcOffsetMin: 480 };

export const OCCUPYING: BookingStatus[] = ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"];
export const RESERVING: BookingStatus[] = ["PENDING", "CONFIRMED"];
export const CHARGED: BookingStatus[] = ["COMPLETED", "NO_SHOW"];
export const FOCUS: SessionFocus[] = ["Upper Body", "Lower Body", "Full Body", "Cardio / HIIT", "Mobility & Form Check"];

interface Details {
  notes: string;
  customGym?: string;
  gymId?: string | null;
}

const aad = (id: string) => `booking:${id}`;
export const sealDetails = (id: string, d: Details) => encryptJson(d, aad(id));

export async function rulesFor(coachId: string): Promise<Rules> {
  const d = await db();
  const [r] = await d.select().from(coachSettings).where(eq(coachSettings.coachId, coachId)).limit(1);
  return r
    ? { sessionMinutes: r.sessionMinutes, noticeHours: r.noticeHours, autoConfirm: r.autoConfirm, allowCustomGym: r.allowCustomGym, utcOffsetMin: r.utcOffsetMin }
    : DEFAULT_RULES;
}

/** Full booking (details decrypted) — only for the coach and the booking's own client. */
export function toBooking(row: BookingRow): Booking {
  let det: Details = { notes: "" };
  try {
    det = decryptJson<Details>(row.detailsEnc, aad(row.id));
  } catch (e) {
    console.error("Could not decrypt booking", row.id, e);
  }
  return {
    id: row.id,
    clientId: row.clientId,
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
    gymId: det.gymId ?? null,
    customGym: det.customGym || undefined,
    focus: row.focus as SessionFocus,
    notes: det.notes ?? "",
    status: row.status as BookingStatus,
    createdBy: row.createdBy as Role,
    createdAt: row.createdAt.toISOString(),
    rev: row.rev,
  };
}

/** What other clients may see of a booking: only that the time is taken. */
function toOccupied(row: BookingRow): Booking {
  return {
    id: row.id,
    clientId: "other",
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
    gymId: null,
    focus: "Full Body",
    notes: "",
    status: row.status as BookingStatus,
    createdBy: "TRAINER",
    createdAt: row.createdAt.toISOString(),
  };
}

export const coachIdFor = (me: UserRow): string | null => (me.role === "CLIENT" ? me.coachId : me.id);

/** Everything the scheduling screens need, scoped to what `me` may see. */
export async function loadSchedule(me: UserRow) {
  const coachId = coachIdFor(me);
  if (!coachId) return { settings: DEFAULT_RULES, gyms: [], slots: [], bookings: [] };
  const d = await db();
  const rules = await rulesFor(coachId);
  const gymRows = await d.select().from(gyms).where(eq(gyms.coachId, coachId));
  const slotRows = await d.select().from(slots).where(eq(slots.coachId, coachId));
  const since = new Date(Date.now() - 120 * 86400000);
  const rows = await d
    .select()
    .from(bookings)
    .where(and(eq(bookings.coachId, coachId), gt(bookings.endAt, since)));

  const list: Booking[] = [];
  for (const r of rows) {
    if (me.role !== "CLIENT" || r.clientId === me.id) list.push(toBooking(r));
    else if (OCCUPYING.includes(r.status as BookingStatus)) list.push(toOccupied(r));
  }
  const gymList: GymLocation[] = gymRows.map((g) => ({ id: g.id, name: g.name, address: g.address, active: g.active }));
  const slotList: AvailabilitySlot[] = slotRows.map((s) => ({
    id: s.id,
    kind: s.kind as AvailabilitySlot["kind"],
    weekday: s.weekday ?? undefined,
    date: s.date ?? undefined,
    start: s.startTime,
    end: s.endTime,
    label: s.label ?? undefined,
  }));
  return { settings: rules, gyms: gymList, slots: slotList, bookings: list };
}

/** Does [start, start+session) sit exactly on one of the coach's open slots (and outside blocked time)? */
export function slotAllowed(start: Date, rules: Rules, slotList: AvailabilitySlot[]): boolean {
  const local = new Date(start.getTime() + rules.utcOffsetMin * 60000); // UTC fields now hold the coach's wall-clock time
  const date = local.toISOString().slice(0, 10);
  const weekday = local.getUTCDay();
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const end = mins + rules.sessionMinutes;
  const blocked = slotList.some((s) => s.kind === "BLOCK" && s.date === date && mins < toMin(s.end) && toMin(s.start) < end);
  if (blocked) return false;
  return slotList.some((s) => {
    if (!((s.kind === "RECURRING" && s.weekday === weekday) || (s.kind === "ONE_OFF" && s.date === date))) return false;
    const ws = toMin(s.start);
    return mins >= ws && end <= toMin(s.end) && (mins - ws) % rules.sessionMinutes === 0;
  });
}

export async function hasConflict(coachId: string, start: Date, end: Date, ignoreId?: string): Promise<boolean> {
  const d = await db();
  const rows = await d
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.coachId, coachId), inArray(bookings.status, OCCUPYING), lt(bookings.startAt, end), gt(bookings.endAt, start)));
  return rows.some((r) => r.id !== ignoreId);
}

export async function reservedCount(clientId: string): Promise<number> {
  const d = await db();
  const [r] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.clientId, clientId), inArray(bookings.status, RESERVING)));
  return r?.n ?? 0;
}

/** Adds `delta` to a client's package balance (never below 0) and returns the new balance. */
export async function adjustCredits(clientRow: UserRow, delta: number): Promise<number> {
  const d = await db();
  const p = openProfile(clientRow);
  p.credits = Math.max(0, p.credits + delta);
  await d.update(users).set({ profileEnc: sealProfile(clientRow.id, p), updatedAt: new Date() }).where(eq(users.id, clientRow.id));
  return p.credits;
}

export const clientCredits = (clientRow: UserRow) => openProfile(clientRow).credits;
