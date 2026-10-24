"use client";

import { useViewer } from "@/lib/hooks";
import { CATALOG, catValue, parseGymValue, placeValue } from "@/lib/gyms";
import type { PlaceInfo } from "@/lib/types";
import { PlaceField } from "./PlaceField";
import { Select } from "./ui";

/**
 * Gym / place picker: Singapore gym chains, condo gym, park and "Others", plus the coach's own saved gyms.
 * Every chain, Condo, Park and Others then ask "Where is the location?" with a Singapore-only Google Maps search
 * (chains are narrowed to that brand's branches). `onPlace` receives the full place (name, address, coordinates).
 */
export function GymSelect({
  value,
  onChange,
  noneLabel = "None",
  allowPlaces = true,
  ariaLabel = "Gym location",
  place = null,
  onPlace,
}: {
  value: string;
  onChange: (v: string) => void;
  noneLabel?: string;
  /** Hide Condo / Park / Others (used when clients may not enter custom locations). */
  allowPlaces?: boolean;
  ariaLabel?: string;
  /** The place currently picked (for showing its address). */
  place?: PlaceInfo | null;
  onPlace?: (p: PlaceInfo | null) => void;
}) {
  const { db } = useViewer();
  const parsed = parseGymValue(value);
  const saved = db.gyms.filter((g) => g.active || (parsed?.kind === "local" && g.id === parsed.id));
  const catalog = parsed?.kind === "cat" || parsed?.kind === "place" ? CATALOG.find((c) => c.key === parsed.key) : undefined;
  const selectValue = parsed?.kind === "cat" || parsed?.kind === "place" ? catValue(parsed.key) : parsed?.kind === "local" ? `gym:${parsed.id}` : "";
  const sameEntry = (a: typeof parsed, b: typeof parsed) => !!a && !!b && (a.kind === "cat" || a.kind === "place") && (b.kind === "cat" || b.kind === "place") && a.key === b.key;
  const chains = CATALOG.filter((c) => c.group === "chain");
  const places = CATALOG.filter((c) => c.group === "place");

  return (
    <div className="space-y-3">
      <Select
        aria-label={ariaLabel}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          const next = parseGymValue(v);
          // Keep a typed or picked place when re-selecting the same entry; reset otherwise.
          if (sameEntry(next, parsed)) onChange(value);
          else {
            onChange(v);
            onPlace?.(null);
          }
        }}
      >
        <option value="">{noneLabel}</option>
        {saved.length > 0 && (
          <optgroup label="My saved gyms">
            {saved.map((g) => (
              <option key={g.id} value={`gym:${g.id}`}>
                {g.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Gyms in Singapore">
          {chains.map((c) => (
            <option key={c.key} value={catValue(c.key)}>
              {c.label}
            </option>
          ))}
        </optgroup>
        {allowPlaces && (
          <optgroup label="Other places">
            {places.map((c) => (
              <option key={c.key} value={catValue(c.key)}>
                {c.label}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      {catalog?.place && (parsed?.kind === "cat" || parsed?.kind === "place") && (
        <PlaceField
          key={catalog.key}
          label={catalog.place.label}
          hint={catalog.place.required ? "Required — search and pick the exact location" : undefined}
          placeholder={catalog.place.placeholder}
          brand={catalog.brand}
          text={parsed.kind === "cat" ? parsed.place : ""}
          selected={parsed.kind === "place" ? { name: parsed.name, address: place?.placeId === parsed.placeId ? place.address : undefined } : null}
          onText={(t) => {
            onChange(catValue(catalog.key, t));
            onPlace?.(null);
          }}
          onPick={(p) => {
            onChange(placeValue(catalog.key, p));
            onPlace?.(p);
          }}
          onClear={() => {
            onChange(catValue(catalog.key));
            onPlace?.(null);
          }}
        />
      )}
    </div>
  );
}
