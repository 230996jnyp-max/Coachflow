import type { GymLocation } from "./types";

/*
 * Where a session or workout happens. A "gym value" is a single string so it can be stored anywhere:
 *   cat:<key>            a gym from the catalogue below          e.g. "cat:anytime-fitness"
 *   cat:<key>|<place>    a catalogue entry with a typed place    e.g. "cat:condo|The Marq", "cat:other|Bishan CC"
 *   gym:<id>             one of the coach's own saved gyms (Settings)
 * Legacy raw ids (no prefix) are treated as saved-gym ids.
 */

export interface CatalogGym {
  key: string;
  label: string;
  group: "chain" | "place";
  /** When set, the coach types the exact place. */
  place?: { label: string; placeholder: string; required: boolean };
}

export const CATALOG: CatalogGym[] = [
  { key: "anytime-fitness", label: "Anytime Fitness (24/7)", group: "chain" },
  { key: "fitness-first", label: "Fitness First", group: "chain" },
  { key: "virgin-active", label: "Virgin Active", group: "chain" },
  { key: "activesg", label: "ActiveSG Gym", group: "chain" },
  { key: "jetts", label: "Jetts Fitness (24/7)", group: "chain" },
  { key: "golds-gym", label: "Gold's Gym", group: "chain" },
  { key: "private-studio", label: "Private PT studio", group: "chain" },
  { key: "condo", label: "Condo gym", group: "place", place: { label: "Condo name", placeholder: "e.g. The Marq, Paterson Hill", required: false } },
  { key: "park", label: "Park / outdoor", group: "place", place: { label: "Park name", placeholder: "e.g. East Coast Park, Bishan-AMK Park", required: false } },
  { key: "other", label: "Others", group: "place", place: { label: "Place", placeholder: "Type the gym or place", required: true } },
];

const byKey = new Map(CATALOG.map((c) => [c.key, c]));

export type ParsedGym = { kind: "cat"; key: string; place: string } | { kind: "local"; id: string };

export function parseGymValue(value: string | null | undefined): ParsedGym | null {
  if (!value) return null;
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

/** Human-readable name, e.g. "Condo gym — The Marq". */
export function gymLabel(value: string | null | undefined, localGyms: GymLocation[]): string {
  const p = parseGymValue(value);
  if (!p) return "";
  if (p.kind === "local") return localGyms.find((g) => g.id === p.id)?.name ?? "";
  const c = byKey.get(p.key)!;
  if (c.key === "other") return p.place.trim();
  return p.place.trim() ? `${c.label} — ${p.place.trim()}` : c.label;
}

/** False when a required place (e.g. "Others") hasn't been typed yet. */
export function isGymComplete(value: string | null | undefined): boolean {
  const p = parseGymValue(value);
  if (!p) return false;
  if (p.kind === "local") return true;
  const c = byKey.get(p.key)!;
  return !c.place?.required || p.place.trim().length > 0;
}

/** Maps a gym value to the booking fields (a saved gym keeps its id; catalogue entries are stored as readable text). */
export function gymToBooking(value: string, localGyms: GymLocation[]): { gymId: string | null; customGym?: string } {
  const p = parseGymValue(value);
  if (p?.kind === "local" && localGyms.some((g) => g.id === p.id)) return { gymId: p.id };
  return { gymId: null, customGym: gymLabel(value, localGyms) || undefined };
}

/** Inverse of gymToBooking, for pre-filling a picker from an existing booking. */
export function bookingToGymValue(b: { gymId: string | null; customGym?: string }): string {
  if (b.gymId) return `gym:${b.gymId}`;
  if (!b.customGym) return "";
  const exact = CATALOG.find((c) => c.label === b.customGym && !c.place);
  if (exact) return catValue(exact.key);
  for (const c of CATALOG) {
    if (c.place && c.key !== "other" && b.customGym.startsWith(`${c.label} — `)) return catValue(c.key, b.customGym.slice(c.label.length + 3));
  }
  return catValue("other", b.customGym);
}
