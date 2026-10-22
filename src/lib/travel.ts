/*
 * Travel-buffer rules for a coach who moves between gyms. Pure functions shared by the browser and the server
 * (no imports), so the slot grid, the coach's schedule and the booking check always agree.
 *
 *  - Same place (same Google place id, or within 300 m, or the same saved gym / identical text): no buffer, back-to-back is fine.
 *  - Two places with coordinates: estimated from the straight-line distance (no maps service needed):
 *      travel = distance x 1.35 (roads are longer than the crow flies) / 30 km/h, plus the coach's parking-and-walking allowance,
 *      rounded up to 5 minutes and capped at the coach's maximum.
 *  - A place without coordinates (old bookings, typed text): the coach's default buffer.
 */

export interface TravelRules {
  travelEnabled: boolean;
  /** Buffer used when either location has no coordinates. */
  travelDefaultMin: number;
  /** Parking / walking allowance added to the estimated drive. */
  travelParkingMin: number;
  /** Upper limit for any buffer. */
  travelMaxMin: number;
}

export const DEFAULT_TRAVEL: TravelRules = { travelEnabled: true, travelDefaultMin: 30, travelParkingMin: 15, travelMaxMin: 90 };

/** Where a session happens, in the fields that matter for travel. */
export interface LocRef {
  gymId?: string | null;
  placeId?: string;
  lat?: number;
  lng?: number;
  /** Place name or typed location, for an exact-text match. */
  text?: string;
}

export const SAME_PLACE_KM = 0.3;
export const ROAD_FACTOR = 1.35;
export const AVG_KMH = 30;

export function locOf(b: { gymId?: string | null; customGym?: string; place?: { placeId: string; name: string; lat?: number; lng?: number } }): LocRef {
  if (b.place) return { placeId: b.place.placeId, lat: b.place.lat, lng: b.place.lng, text: b.place.name };
  if (b.gymId) return { gymId: b.gymId };
  return { text: b.customGym };
}

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const hasCoords = (l: LocRef): l is LocRef & { lat: number; lng: number } => typeof l.lat === "number" && typeof l.lng === "number";

export function sameLocation(a: LocRef, b: LocRef): boolean {
  if (a.placeId && a.placeId === b.placeId) return true;
  if (a.gymId && a.gymId === b.gymId) return true;
  if (hasCoords(a) && hasCoords(b)) return haversineKm(a.lat, a.lng, b.lat, b.lng) <= SAME_PLACE_KM;
  const ta = norm(a.text);
  return ta.length > 0 && ta === norm(b.text);
}

/** Minutes the coach needs between the end of one session and the start of the next at these two places. */
export function bufferMinutes(a: LocRef, b: LocRef, rules: TravelRules): number {
  if (!rules.travelEnabled) return 0;
  if (sameLocation(a, b)) return 0;
  const cap = Math.max(0, rules.travelMaxMin);
  if (hasCoords(a) && hasCoords(b)) {
    const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
    const drive = Math.ceil(((km * ROAD_FACTOR) / AVG_KMH) * 60);
    const total = Math.ceil((drive + Math.max(0, rules.travelParkingMin)) / 5) * 5;
    return Math.min(cap, Math.max(5, total));
  }
  return Math.min(cap, Math.max(0, rules.travelDefaultMin));
}

/** What a client's browser needs to know about one existing session to judge a slot (no names, no places). */
export interface TravelNeighbor {
  start: string;
  end: string;
  /** Minutes of travel needed between this session and one at the location being considered. */
  buffer: number;
  /** True when this session is at the same place as the one being considered. */
  same: boolean;
}

export type TravelVerdict = { ok: true; backToBackSame: boolean } | { ok: false; need: number; gap: number; before: boolean };

/** Does a session [start, end) leave enough travel time around each neighbouring session? */
export function checkNeighbors(start: Date, end: Date, neighbors: TravelNeighbor[]): TravelVerdict {
  let backToBackSame = false;
  for (const n of neighbors) {
    const ns = new Date(n.start).getTime();
    const ne = new Date(n.end).getTime();
    if (ne <= start.getTime()) {
      const gap = (start.getTime() - ne) / 60000;
      if (gap < n.buffer) return { ok: false, need: n.buffer, gap, before: true };
      if (n.same && gap === 0) backToBackSame = true;
    } else if (ns >= end.getTime()) {
      const gap = (ns - end.getTime()) / 60000;
      if (gap < n.buffer) return { ok: false, need: n.buffer, gap, before: false };
      if (n.same && gap === 0) backToBackSame = true;
    }
  }
  return { ok: true, backToBackSame };
}
