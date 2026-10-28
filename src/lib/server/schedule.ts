import "server-only";
import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import type { AvailabilitySlot, Booking, BookingStatus, GymLocation, PlaceInfo, Role, SessionFocus } from "@/lib/types";
import { badRequest } from "./http";
import { cleanSports, BASE_FOCUS } from "@/lib/sports";
import { bufferMinutes, locOf, sameLocation, type LocRef, type TravelNeighbor, type TravelRules } from "@/lib/travel";
import { openProfile, sealProfile, type ProfileJson } from "./accounts";
import { decryptJson, encryptJson } from "./crypto";
import { db } from "./db";
import { attendance, bookings, coachSettings, groupSessions, gyms, slots, users, type BookingRow, type UserRow } from "./schema";

export interface Rules extends TravelRules {
  sessionMinutes: number;
  noticeHours: number;
  autoConfirm: boolean;
  allowCustomGym: boolean;
  /** Coach's UTC offset in minutes (Singapore = 480); positions availability windows. */
  utcOffsetMin: number;
  /** What the coach specialises in, and the sports they added with AI (names). */
  specialties: string[];
  sports: string[];
}

export const DEFAULT_RULES: Rules = {
  sessionMinutes: 60,
  noticeHours: 12,
  autoConfirm: true,
  allowCustomGym: true,
  utcOffsetMin: 480,
  travelEnabled: true,
  travelDefaultMin: 30,
  travelParkingMin: 15,
  travelMaxMin: 90,
  specialties: [],
  sports: [],
};

export const OCCUPYING: BookingStatus[] = ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"];
export const RESERVING: BookingStatus[] = ["PENDING", "CONFIRMED"];
export const CHARGED: BookingStatus[] = ["COMPLETED", "NO_SHOW"];
export const FOCUS: SessionFocus[] = BASE_FOCUS;

export interface Details {
  notes: string;
  customGym?: string;
  gymId?: string | null;
  /** Exact Google Maps place picked for this session (encrypted with the rest of the details). */
  place?: PlaceInfo;
}

/** Validates a place coming from the browser (it is rebuilt field by field, never stored as sent). */
export function parsePlace(raw: unknown): PlaceInfo | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw badRequest("That place isn't valid.");
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const placeId = text(r.placeId, 200);
  const name = text(r.name, 150);
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(placeId) || !name) throw badRequest("That place isn't valid.");
  const out: PlaceInfo = { placeId, name, address: text(r.address, 300) };
  if (typeof r.lat === "number" && Number.isFinite(r.lat) && Math.abs(r.lat) <= 90 && typeof r.lng === "number" && Number.isFinite(r.lng) && Math.abs(r.lng) <= 180) {
    out.lat = r.lat;
    out.lng = r.lng;
  }
  if (r.home === true) out.home = true;
  return out;
}

/** Applies a `homeAddress` request value ({ place } | { text } | null) to a client's profile. */
export function applyHomeAddress(p: ProfileJson, raw: unknown): void {
  if (raw === null) {
    delete p.homePlace;
    delete p.homeText;
    return;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) throw badRequest("That home address isn't valid.");
  const r = raw as Record<string, unknown>;
  const place = parsePlace(r.place);
  if (place) {
    p.homePlace = { ...place, home: true };
    delete p.homeText;
  } else if (typeof r.text === "string") {
    const t = r.text.replace(/\s+/g, " ").trim().slice(0, 140);
    if (!t) throw badRequest("Please enter the home address.");
    p.homeText = t;
    delete p.homePlace;
  } else throw badRequest("That home address isn't valid.");
}

const aad = (id: string) => `booking:${id}`;
export const sealDetails = (id: string, d: Details) => encryptJson(d, aad(id));

function parseJsonList(s: string | null | undefined): unknown {
  try {
    return JSON.parse(s || "[]");
  } catch {
    return [];
  }
}

export async function rulesFor(coachId: string): Promise<Rules> {
  const d = await db();
  const [r] = await d.select().from(coachSettings).where(eq(coachSettings.coachId, coachId)).limit(1);
  return r
    ? {
        sessionMinutes: r.sessionMinutes,
        noticeHours: r.noticeHours,
        autoConfirm: r.autoConfirm,
        allowCustomGym: r.allowCustomGym,
        utcOffsetMin: r.utcOffsetMin,
        travelEnabled: r.travelEnabled,
        travelDefaultMin: r.travelDefaultMin,
        travelParkingMin: r.travelParkingMin,
        travelMaxMin: r.travelMaxMin,
        specialties: cleanSports(parseJsonList(r.specialties)),
        sports: cleanSports(parseJsonList(r.sports)),
      }
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
    place: det.place,
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
  const since = new Date(Date.now() - 120 * 86400000);
  // Independent reads run together (each one is a round trip to the database).
  const [rules, gymRows, slotRows, rows] = await Promise.all([
    rulesFor(coachId),
    d.select().from(gyms).where(eq(gyms.coachId, coachId)),
    d.select().from(slots).where(eq(slots.coachId, coachId)),
    d.select().from(bookings).where(and(eq(bookings.coachId, coachId), gt(bookings.endAt, since))),
  ]);

  const list: Booking[] = [];
  const detailIds = rows.filter((r) => me.role !== "CLIENT" || r.clientId === me.id).map((r) => r.id);
  const marks = new Map<string, { mark: string; charged: boolean }>();
  const sharedBy = new Map<string, string>();
  if (detailIds.length) {
    const [recs, shared] = await Promise.all([
      d.select().from(attendance).where(and(eq(attendance.kind, "BOOKING"), inArray(attendance.sessionId, detailIds))),
      d.select({ id: groupSessions.id, bookingId: groupSessions.bookingId }).from(groupSessions).where(and(inArray(groupSessions.bookingId, detailIds), ne(groupSessions.status, "CANCELLED"))),
    ]);
    for (const a of recs) marks.set(`${a.sessionId}:${a.clientId}`, a);
    for (const g of shared) if (g.bookingId) sharedBy.set(g.bookingId, g.id);
  }
  for (const r of rows) {
    if (me.role !== "CLIENT" || r.clientId === me.id) {
      const b = toBooking(r);
      const a = marks.get(`${r.id}:${r.clientId}`);
      if (a) b.attendance = { mark: a.mark as "PRESENT" | "NO_SHOW", deduct: a.mark === "NO_SHOW" && a.charged };
      const g = sharedBy.get(r.id);
      if (g) b.sharedGroupId = g;
      list.push(b);
    } else if (OCCUPYING.includes(r.status as BookingStatus)) list.push(toOccupied(r));
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

export async function hasConflict(coachId: string, start: Date, end: Date, ignoreId?: string, ignoreGroupId?: string): Promise<boolean> {
  const d = await db();
  const rows = await d
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.coachId, coachId), inArray(bookings.status, OCCUPYING), lt(bookings.startAt, end), gt(bookings.endAt, start)));
  if (rows.some((r) => r.id !== ignoreId)) return true;
  // A coach's group class blocks the same time.
  const classes = await d
    .select({ id: groupSessions.id })
    .from(groupSessions)
    .where(and(eq(groupSessions.coachId, coachId), eq(groupSessions.kind, "CLASS"), ne(groupSessions.status, "CANCELLED"), lt(groupSessions.startAt, end), gt(groupSessions.endAt, start)));
  return classes.some((c) => c.id !== ignoreGroupId);
}

/** A coach's group classes in a time window, with the location each one is held at (for travel-time checks). */
export async function classEntries(coachId: string, from: Date, to: Date, ignoreGroupId?: string): Promise<{ id: string; start: Date; end: Date; loc: LocRef }[]> {
  const d = await db();
  const rows = await d
    .select()
    .from(groupSessions)
    .where(and(eq(groupSessions.coachId, coachId), eq(groupSessions.kind, "CLASS"), ne(groupSessions.status, "CANCELLED"), lt(groupSessions.startAt, to), gt(groupSessions.endAt, from)));
  const out: { id: string; start: Date; end: Date; loc: LocRef }[] = [];
  for (const r of rows) {
    if (r.id === ignoreGroupId) continue;
    let det: { gymId?: string | null; customGym?: string; place?: PlaceInfo } = {};
    try {
      det = decryptJson(r.detailsEnc, `group:${r.id}`);
    } catch {
      /* unknown location */
    }
    out.push({ id: r.id, start: r.startAt, end: r.endAt, loc: locOf({ gymId: det.gymId ?? null, customGym: det.customGym, place: det.place }) });
  }
  return out;
}

/** The location fields of a booking request, as the travel rules see them. */
export function requestLoc(input: { gymId?: string | null; customGym?: string; place?: PlaceInfo }): LocRef {
  return locOf({ gymId: input.gymId ?? null, customGym: input.customGym, place: input.place });
}

/**
 * Is there enough travel time before and after [start, end) for a session at `loc`? Returns a message when there is
 * not (null when fine). Sessions at the same place need no buffer; a coach can waive the rule when booking directly.
 */
export async function travelCheck(coachId: string, start: Date, end: Date, loc: LocRef, rules: Rules, ignoreId: string | undefined, forCoach: boolean): Promise<string | null> {
  if (!rules.travelEnabled) return null;
  const d = await db();
  const pad = Math.max(0, rules.travelMaxMin) * 60000;
  const rows = await d
    .select()
    .from(bookings)
    .where(and(eq(bookings.coachId, coachId), inArray(bookings.status, OCCUPYING), lt(bookings.startAt, new Date(end.getTime() + pad)), gt(bookings.endAt, new Date(start.getTime() - pad))));
  const entries: { id: string; start: Date; end: Date; loc: LocRef }[] = rows.map((row) => ({ id: row.id, start: row.startAt, end: row.endAt, loc: locOf(toBooking(row)) }));
  entries.push(...(await classEntries(coachId, new Date(start.getTime() - pad), new Date(end.getTime() + pad), ignoreId)));
  for (const row of entries) {
    if (row.id === ignoreId) continue;
    const need = bufferMinutes(row.loc, loc, rules);
    if (need === 0) continue;
    const before = row.end.getTime() <= start.getTime();
    const after = row.start.getTime() >= end.getTime();
    if (!before && !after) continue; // an overlap is reported by the clash check
    const gap = Math.round((before ? start.getTime() - row.end.getTime() : row.start.getTime() - end.getTime()) / 60000);
    if (gap < need) {
      return forCoach
        ? `Not enough travel time: this client's gym is a different location from the ${before ? "previous" : "next"} session, which needs about ${need} min (only ${gap} min free). Choose another time, or switch on "Waive travel buffer".`
        : `That time doesn't leave enough travel time for your coach between locations (about ${need} min needed). Choose a later or earlier time, or train at the same gym as the neighbouring session.`;
    }
  }
  return null;
}

/** Sessions near `loc` with the buffer each one needs, for a client's slot grid (times only; no names or places). */
export async function travelNeighbors(coachId: string, loc: LocRef, rules: Rules): Promise<TravelNeighbor[]> {
  const d = await db();
  const rows = await d
    .select()
    .from(bookings)
    .where(and(eq(bookings.coachId, coachId), inArray(bookings.status, OCCUPYING), gt(bookings.endAt, new Date(Date.now() - 86400000)), lt(bookings.startAt, new Date(Date.now() + 120 * 86400000))));
  const out = rows.map((row) => {
    const b = toBooking(row);
    const other = locOf(b);
    return { start: row.startAt.toISOString(), end: row.endAt.toISOString(), buffer: bufferMinutes(other, loc, rules), same: rules.travelEnabled && sameLocation(other, loc) };
  });
  for (const c of await classEntries(coachId, new Date(Date.now() - 86400000), new Date(Date.now() + 120 * 86400000))) {
    out.push({ start: c.start.toISOString(), end: c.end.toISOString(), buffer: bufferMinutes(c.loc, loc, rules), same: rules.travelEnabled && sameLocation(c.loc, loc) });
  }
  return out;
}

/**
 * 1-on-1 credits promised to upcoming sessions. A session that already has an attendance mark has settled its credit,
 * and one opened to partners uses a group credit instead.
 */
export async function reservedCount(clientId: string): Promise<number> {
  const d = await db();
  const rows = await d.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.clientId, clientId), inArray(bookings.status, RESERVING)));
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const marked = new Set((await d.select({ s: attendance.sessionId }).from(attendance).where(and(eq(attendance.kind, "BOOKING"), eq(attendance.clientId, clientId), inArray(attendance.sessionId, ids)))).map((r) => r.s));
  const shared = new Set((await d.select({ b: groupSessions.bookingId }).from(groupSessions).where(and(inArray(groupSessions.bookingId, ids), ne(groupSessions.status, "CANCELLED")))).map((r) => r.b));
  return ids.filter((id) => !marked.has(id) && !shared.has(id)).length;
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

/** Adds `delta` to a client's group-class credits (never below 0) and returns the new balance. */
export async function adjustGroupCredits(clientRow: UserRow, delta: number): Promise<number> {
  const d = await db();
  const p = openProfile(clientRow);
  p.groupClassCredits = Math.max(0, (p.groupClassCredits ?? 0) + delta);
  await d.update(users).set({ profileEnc: sealProfile(clientRow.id, p), updatedAt: new Date() }).where(eq(users.id, clientRow.id));
  return p.groupClassCredits;
}
