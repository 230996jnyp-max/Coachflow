import { addMinutes, format, isBefore, parseISO } from "date-fns";
import { bufferMinutes, checkNeighbors, locOf, type LocRef, type TravelNeighbor } from "./travel";
import type { AppSettings, AvailabilitySlot, Booking, ClientProfile, Role } from "./types";

export const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** Build a local Date from "yyyy-MM-dd" + "HH:mm". */
export function atTime(date: string, hhmm: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export const OCCUPYING: Booking["status"][] = ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"];
export const ACTIVE_UPCOMING: Booking["status"][] = ["PENDING", "CONFIRMED"];

const overlaps = (aS: Date, aE: Date, bS: Date, bE: Date) => aS < bE && bS < aE;

/** "travel" = free, but the coach could not get there from another location in time. */
export type SlotState = "open" | "mine" | "taken" | "past" | "late" | "travel";

export interface SlotView {
  key: string;
  start: Date;
  end: Date;
  state: SlotState;
  booking?: Booking;
  /** True when this entry is a booking that sits outside the published availability. */
  offSchedule?: boolean;
  /** Open slot directly next to a session at the same place: no travel needed. */
  backToBack?: boolean;
  /** Minutes of travel the coach would need (state "travel"). */
  travelNeed?: number;
}

interface Source {
  slots: AvailabilitySlot[];
  bookings: Booking[];
  settings: AppSettings;
}

export function blocksForDay(day: Date, slots: AvailabilitySlot[]): AvailabilitySlot[] {
  const d = ymd(day);
  return slots.filter((s) => s.kind === "BLOCK" && s.date === d);
}

export function windowsForDay(day: Date, slots: AvailabilitySlot[]): AvailabilitySlot[] {
  const d = ymd(day);
  const wd = day.getDay();
  return slots.filter(
    (s) => (s.kind === "RECURRING" && s.weekday === wd) || (s.kind === "ONE_OFF" && s.date === d),
  );
}

/** Slots for a given day, merged with bookings. `clientId` marks which bookings are "mine". */
export function buildDaySlots(
  day: Date,
  src: Source,
  opts: { now: Date; clientId?: string; role: Role; /** Sessions near the chosen location with the buffer each needs (clients, once a location is picked). */ travel?: TravelNeighbor[] | null },
): SlotView[] {
  const { now, clientId, role, travel } = opts;
  const step = src.settings.sessionMinutes;
  const blocks = blocksForDay(day, src.slots).map((b) => ({
    s: atTime(ymd(day), b.start),
    e: atTime(ymd(day), b.end),
  }));
  const dayBookings = src.bookings.filter(
    (b) => OCCUPYING.includes(b.status) && ymd(parseISO(b.start)) === ymd(day),
  );

  const seen = new Set<number>();
  const views: SlotView[] = [];
  const matched = new Set<string>();

  for (const w of windowsForDay(day, src.slots)) {
    const wEnd = atTime(ymd(day), w.end);
    for (let s = atTime(ymd(day), w.start); addMinutes(s, step) <= wEnd; s = addMinutes(s, step)) {
      const e = addMinutes(s, step);
      if (seen.has(s.getTime())) continue;
      seen.add(s.getTime());
      if (blocks.some((b) => overlaps(s, e, b.s, b.e))) continue;
      const bk = dayBookings.find((b) => overlaps(s, e, parseISO(b.start), parseISO(b.end)));
      let state: SlotState;
      if (bk) {
        matched.add(bk.id);
        state = bk.clientId === clientId ? "mine" : "taken";
      } else if (isBefore(s, now)) state = "past";
      else if (role === "CLIENT" && isBefore(s, addMinutes(now, src.settings.noticeHours * 60))) state = "late";
      else state = "open";
      let backToBack = false;
      let travelNeed: number | undefined;
      if (state === "open" && travel) {
        const v = checkNeighbors(s, e, travel);
        if (!v.ok) {
          state = "travel";
          travelNeed = v.need;
        } else backToBack = v.backToBackSame;
      }
      views.push({ key: `${s.getTime()}`, start: s, end: e, state, booking: bk, backToBack, travelNeed });
    }
  }

  for (const b of dayBookings) {
    if (matched.has(b.id)) continue;
    views.push({
      key: `bk_${b.id}`,
      start: parseISO(b.start),
      end: parseISO(b.end),
      state: b.clientId === clientId ? "mine" : "taken",
      booking: b,
      offSchedule: true,
    });
  }
  return views.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function reservedCount(bookings: Booking[], clientId: string): number {
  // A session with an attendance mark has settled its credit; one opened to partners uses a group credit instead.
  return bookings.filter((b) => b.clientId === clientId && ACTIVE_UPCOMING.includes(b.status) && !b.attendance && !b.sharedGroupId).length;
}

export function availableCredits(profile: ClientProfile, bookings: Booking[]): number {
  return profile.credits - reservedCount(bookings, profile.id);
}

export function bookingConflict(bookings: Booking[], start: Date, end: Date, ignoreId?: string): Booking | undefined {
  return bookings.find(
    (b) =>
      b.id !== ignoreId &&
      OCCUPYING.includes(b.status) &&
      overlaps(start, end, parseISO(b.start), parseISO(b.end)),
  );
}

/**
 * Coach-side check (the coach sees every booking): would a session at `loc` leave too little travel time next to a
 * session at another place? Returns a plain-language problem, or null when it fits. The server checks the same rule.
 */
export function travelProblem(bookings: Booking[], start: Date, end: Date, loc: LocRef, s: AppSettings, ignoreId?: string): string | null {
  if (!s.travelEnabled) return null;
  for (const b of bookings) {
    if (b.id === ignoreId || !OCCUPYING.includes(b.status)) continue;
    const bs = parseISO(b.start);
    const be = parseISO(b.end);
    const before = be.getTime() <= start.getTime();
    const after = bs.getTime() >= end.getTime();
    if (!before && !after) continue;
    const need = bufferMinutes(locOf(b), loc, s);
    if (need === 0) continue;
    const gap = Math.round((before ? start.getTime() - be.getTime() : bs.getTime() - end.getTime()) / 60000);
    if (gap < need) return `Only ${gap} min between this and the ${before ? "previous" : "next"} session, which is at a different location — about ${need} min of travel is needed.`;
  }
  return null;
}

export function canCancel(b: Booking, now: Date, settings: AppSettings, role: Role): string | null {
  if (!ACTIVE_UPCOMING.includes(b.status)) return "This session can no longer be cancelled.";
  if (role === "TRAINER") return null;
  const cutoff = addMinutes(parseISO(b.start), -settings.noticeHours * 60);
  if (isBefore(cutoff, now))
    return `Sessions can only be cancelled ${settings.noticeHours}h or more before they start — message your trainer.`;
  return null;
}

export const STATUS_STYLES: Record<Booking["status"], string> = {
  PENDING: "bg-pr/15 text-pr border-pr/30",
  CONFIRMED: "bg-accent/15 text-accent border-accent/30",
  COMPLETED: "bg-success/15 text-success border-success/30",
  CANCELLED: "bg-line text-muted border-line",
  DECLINED: "bg-danger/15 text-danger border-danger/30",
  NO_SHOW: "bg-danger/15 text-danger border-danger/30",
};

export const STATUS_LABEL: Record<Booking["status"], string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  DECLINED: "Declined",
  NO_SHOW: "No-show",
};
