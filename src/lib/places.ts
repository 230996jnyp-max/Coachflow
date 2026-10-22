import type { PlaceInfo } from "./types";

/*
 * Singapore place search through Google's Places API (New), called straight from the browser with the public
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (restricted to this site's domain in Google Cloud). Where the key is missing or not
 * allowed for the current page (e.g. localhost) the calls fail with PERMISSION_DENIED and the UI falls back to typing.
 *
 *  - Brand mode (a gym chain was chosen): Text Search for "<brand> <typed>", keeping only that brand's branches.
 *  - Open mode (condo / park / other / any address or postal code): Autocomplete, then Place Details for the pick.
 */

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
export const mapsConfigured = MAPS_KEY.length > 0;

const BASE = "https://places.googleapis.com/v1";
const FIELDS = "id,displayName,formattedAddress,location";

export interface Suggestion {
  /** Set when the full place is already known (text search). */
  place?: PlaceInfo;
  /** Autocomplete prediction: resolved with placeDetails() when picked. */
  placeId: string;
  title: string;
  subtitle: string;
}

export type SearchResult = { ok: true; items: Suggestion[] } | { ok: false; denied: boolean; message: string };

interface ApiPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

const toPlace = (p: ApiPlace): PlaceInfo | null =>
  p.id && p.displayName?.text
    ? { placeId: p.id, name: p.displayName.text, address: p.formattedAddress ?? "", lat: p.location?.latitude, lng: p.location?.longitude }
    : null;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function call(path: string, init: RequestInit & { fieldMask?: string }, signal?: AbortSignal): Promise<{ ok: true; data: unknown } | { ok: false; denied: boolean; message: string }> {
  if (!mapsConfigured) return { ok: false, denied: true, message: "Map search isn't set up." };
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": MAPS_KEY,
        ...(init.fieldMask ? { "X-Goog-FieldMask": init.fieldMask } : {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
    if (!res.ok) {
      const status = data.error?.status ?? "";
      return { ok: false, denied: res.status === 403 || res.status === 401 || status === "PERMISSION_DENIED" || status === "UNAUTHENTICATED", message: data.error?.message ?? `Search failed (${res.status}).` };
    }
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { ok: false, denied: false, message: "Couldn't reach Google Maps. Check your connection." };
  }
}

/** Every branch of one chain in Singapore, narrowed by whatever the user has typed (e.g. "Sengkang"). */
export async function searchBranches(brand: string, typed: string, signal?: AbortSignal): Promise<SearchResult> {
  const r = await call(
    "/places:searchText",
    {
      method: "POST",
      body: JSON.stringify({ textQuery: `${brand} ${typed}`.trim() + " Singapore", regionCode: "SG", languageCode: "en", pageSize: 15 }),
      fieldMask: FIELDS.split(",").map((f) => `places.${f}`).join(","),
    },
    signal,
  );
  if (!r.ok) return r;
  const places = ((r.data as { places?: ApiPlace[] }).places ?? []).map(toPlace).filter((p): p is PlaceInfo => !!p);
  const key = norm(brand);
  // Only that brand's branches (Google may also return nearby gyms of other brands).
  const items = places
    .filter((p) => norm(p.name).includes(key))
    .map((p) => ({ place: p, placeId: p.placeId, title: p.name, subtitle: p.address }));
  return { ok: true, items };
}

let session = "";
/** Autocomplete groups a typing session with its final selection for billing; a new token starts after each pick. */
export const newSession = () => {
  session = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
};

/** Singapore gyms, condos, streets and postal codes. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<SearchResult> {
  const q = query.trim();
  if (!session) newSession();
  // A 6-digit postal code is looked up directly: it returns the building, not just a street prediction.
  if (/^\d{6}$/.test(q)) {
    const r = await call(
      "/places:searchText",
      { method: "POST", body: JSON.stringify({ textQuery: `Singapore ${q}`, regionCode: "SG", languageCode: "en", pageSize: 6 }), fieldMask: FIELDS.split(",").map((f) => `places.${f}`).join(",") },
      signal,
    );
    if (!r.ok) return r;
    const items = ((r.data as { places?: ApiPlace[] }).places ?? []).map(toPlace).filter((p): p is PlaceInfo => !!p).map((p) => ({ place: p, placeId: p.placeId, title: p.name, subtitle: p.address }));
    return { ok: true, items };
  }
  const r = await call(
    "/places:autocomplete",
    { method: "POST", body: JSON.stringify({ input: q, includedRegionCodes: ["sg"], languageCode: "en", sessionToken: session }) },
    signal,
  );
  if (!r.ok) return r;
  const suggestions = ((r.data as { suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[] }).suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId);
  return {
    ok: true,
    items: suggestions.slice(0, 8).map((p) => ({
      placeId: p.placeId!,
      title: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      subtitle: p.structuredFormat?.secondaryText?.text ?? "",
    })),
  };
}

/** Full name, address and coordinates for an autocomplete pick. */
export async function placeDetails(placeId: string, signal?: AbortSignal): Promise<{ ok: true; place: PlaceInfo } | { ok: false; message: string }> {
  const r = await call(`/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(session)}&languageCode=en`, { method: "GET", fieldMask: FIELDS }, signal);
  newSession();
  if (!r.ok) return { ok: false, message: r.message };
  const place = toPlace(r.data as ApiPlace);
  return place ? { ok: true, place } : { ok: false, message: "Couldn't read that place." };
}
