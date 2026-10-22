import type { GymLocation, PlaceInfo } from "./types";

/*
 * Where a session or workout happens. A "gym value" is a single string so it can be stored anywhere:
 *   cat:<key>            a gym from the catalogue below          e.g. "cat:anytime-fitness"
 *   cat:<key>|<place>    a catalogue entry with a typed place    e.g. "cat:condo|The Marq", "cat:other|Bishan CC"
 *   gym:<id>             one of the coach's own saved gyms (Settings)
 *   p:<key>:<placeId>|<name>   a place picked from Google Maps search, e.g. "p:anytime-fitness:ChIJ...|Anytime Fitness Sengkang"
 * Legacy raw ids (no prefix) are treated as saved-gym ids.
 */

export interface CatalogGym {
  key: string;
  label: string;
  group: "chain" | "place";
  /** Brand name used to narrow the Google Maps search to that chain's branches. */
  brand?: string;
  /** When set, the coach types the exact place. */
  place?: { label: string; placeholder: string; required: boolean };
}

const BRANCH = { label: "Where is the location / branch?", placeholder: "e.g. Sengkang", required: true };

export const CATALOG: CatalogGym[] = [
  { key: "anytime-fitness", label: "Anytime Fitness (24/7)", group: "chain", brand: "Anytime Fitness", place: BRANCH },
  { key: "fitness-first", label: "Fitness First", group: "chain", brand: "Fitness First", place: BRANCH },
  { key: "virgin-active", label: "Virgin Active", group: "chain", brand: "Virgin Active", place: BRANCH },
  { key: "activesg", label: "ActiveSG Gym", group: "chain", brand: "ActiveSG", place: BRANCH },
  { key: "jetts", label: "Jetts Fitness (24/7)", group: "chain", brand: "Jetts", place: BRANCH },
  { key: "golds-gym", label: "Gold's Gym", group: "chain", brand: "Gold's Gym", place: BRANCH },
  { key: "private-studio", label: "Private PT studio", group: "chain", place: { label: "Where is the studio?", placeholder: "Studio name or address", required: true } },
  { key: "condo", label: "Condo gym", group: "place", place: { label: "Where is the location?", placeholder: "Condo name, street or postal code", required: false } },
  { key: "park", label: "Park / outdoor", group: "place", place: { label: "Where is the location?", placeholder: "Park name or meeting point", required: false } },
  { key: "other", label: "Others", group: "place", place: { label: "Where is the location?", placeholder: "Gym name, street or 6-digit postal code", required: true } },
];

const byKey = new Map(CATALOG.map((c) => [c.key, c]));

export type ParsedGym =
  | { kind: "cat"; key: string; place: string }
  | { kind: "local"; id: string }
  | { kind: "place"; key: string; placeId: string; name: string };

export function parseGymValue(value: string | null | undefined): ParsedGym | null {
  if (!value) return null;
  if (value.startsWith("p:")) {
    const m = value.match(/^p:([a-z-]+):([A-Za-z0-9_-]+)\|([\s\S]*)$/);
    return m ? { kind: "place", key: byKey.has(m[1]) ? m[1] : "other", placeId: m[2], name: m[3] } : null;
  }
  if (value.startsWith("cat:")) {
    const rest = value.slice(4);
    const i = rest.indexOf("|");
    const key = i === -1 ? rest : rest.slice(0, i);
    if (!byKey.has(key)) return null;
    return { kind: "cat", key, place: i === -1 ? "" : rest.slice(i + 1) };
  }
  if (value.startsWith("gym:")) return { kind: "local", id: value.slice(4) };
  return { kind: "local", id: value };
}

export const catValue = (key: string, place = "") => (place ? `cat:${key}|${place}` : `cat:${key}`);

/** Value for a place picked from Google Maps search. The name is capped so the whole string stays under the 140-character limit. */
export const placeValue = (key: string, p: Pick<PlaceInfo, "placeId" | "name">) => `p:${key}:${p.placeId}|${p.name.replace(/\s+/g, " ").trim().slice(0, 70)}`;

const mapsDir = "https://www.google.com/maps/dir/?api=1&destination=";

/** Google Maps directions link for a place (exact when we know its place id), otherwise a search for the text. */
export function directionsUrl(t: { place?: Pick<PlaceInfo, "placeId" | "name" | "address">; label?: string }): string {
  if (t.place?.placeId) {
    return `${mapsDir}${encodeURIComponent(t.place.address || t.place.name)}&destination_place_id=${encodeURIComponent(t.place.placeId)}`;
  }
  return `${mapsDir}${encodeURIComponent(`${t.label ?? ""} Singapore`.trim())}`;
}

/** Where to send someone for directions to a gym value (a place, a saved gym with an address, or a catalogue entry with a typed place). */
export function directionsForValue(value: string | null | undefined, localGyms: GymLocation[]): string | null {
  const p = parseGymValue(value);
  if (!p) return null;
  if (p.kind === "place") return directionsUrl({ place: { placeId: p.placeId, name: p.name, address: p.name } });
  if (p.kind === "local") {
    const g = localGyms.find((x) => x.id === p.id);
    return g ? directionsUrl({ label: g.address || g.name }) : null;
  }
  const label = gymLabel(value, localGyms);
  return label && p.place.trim() ? directionsUrl({ label }) : null;
}

/** Human-readable name, e.g. "Condo gym — The Marq". */
export function gymLabel(value: string | null | undefined, localGyms: GymLocation[]): string {
  const p = parseGymValue(value);
  if (!p) return "";
  if (p.kind === "local") return localGyms.find((g) => g.id === p.id)?.name ?? "";
  if (p.kind === "place") return p.name;
  const c = byKey.get(p.key)!;
  if (c.key === "other") return p.place.trim();
  return p.place.trim() ? `${c.label} — ${p.place.trim()}` : c.label;
}

/** False when a required place (e.g. "Others") hasn't been typed yet. */
export function isGymComplete(value: string | null | undefined): boolean {
  const p = parseGymValue(value);
  if (!p) return false;
  if (p.kind === "local" || p.kind === "place") return true;
  const c = byKey.get(p.key)!;
  return !c.place?.required || p.place.trim().length > 0;
}

/** Maps a gym value to the booking fields (a saved gym keeps its id; catalogue entries are stored as readable text). */
export function gymToBooking(value: string, localGyms: GymLocation[]): { gymId: string | null; customGym?: string } {
  const p = parseGymValue(value);
  if (p?.kind === "local" && localGyms.some((g) => g.id === p.id)) return { gymId: p.id };
  return { gymId: null, customGym: gymLabel(value, localGyms) || undefined };
}

/** The full place to store with a booking: the one just picked, or one rebuilt from a stored place value (name only). */
export function placeForBooking(value: string, picked: PlaceInfo | null): PlaceInfo | null {
  const p = parseGymValue(value);
  if (p?.kind !== "place") return null;
  if (picked && picked.placeId === p.placeId) return picked;
  return { placeId: p.placeId, name: p.name, address: p.name };
}

/** Inverse of gymToBooking, for pre-filling a picker from an existing booking. */
export function bookingToGymValue(b: { gymId: string | null; customGym?: string; place?: PlaceInfo }): string {
  if (b.gymId) return `gym:${b.gymId}`;
  if (b.place) {
    const brandKey = CATALOG.find((c) => c.brand && b.place!.name.toLowerCase().includes(c.brand.toLowerCase()))?.key ?? "other";
    return placeValue(brandKey, b.place);
  }
  if (!b.customGym) return "";
  const exact = CATALOG.find((c) => c.label === b.customGym && !c.place);
  if (exact) return catValue(exact.key);
  for (const c of CATALOG) {
    if (c.place && c.key !== "other" && b.customGym.startsWith(`${c.label} — `)) return catValue(c.key, b.customGym.slice(c.label.length + 3));
  }
  return catValue("other", b.customGym);
}
