"use client";

import { useViewer } from "@/lib/hooks";
import { CATALOG, catValue, parseGymValue } from "@/lib/gyms";
import { Field, Input, Select } from "./ui";

/**
 * Gym / place picker: Singapore gym chains, condo gym, park and "Others", plus the coach's own saved gyms.
 * Condo, Park and Others reveal a text box for the exact place ("Others" requires it).
 */
export function GymSelect({
  value,
  onChange,
  noneLabel = "None",
  allowPlaces = true,
  ariaLabel = "Gym location",
}: {
  value: string;
  onChange: (v: string) => void;
  noneLabel?: string;
  /** Hide Condo / Park / Others (used when clients may not enter custom locations). */
  allowPlaces?: boolean;
  ariaLabel?: string;
}) {
  const { db } = useViewer();
  const parsed = parseGymValue(value);
  const saved = db.gyms.filter((g) => g.active || (parsed?.kind === "local" && g.id === parsed.id));
  const catalog = parsed?.kind === "cat" ? CATALOG.find((c) => c.key === parsed.key) : undefined;
  const selectValue = parsed?.kind === "cat" ? catValue(parsed.key) : parsed?.kind === "local" ? `gym:${parsed.id}` : "";
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
          // Keep a typed place when switching between the same entry; reset otherwise.
          onChange(next?.kind === "cat" && parsed?.kind === "cat" && next.key === parsed.key ? value : v);
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
      {catalog?.place && parsed?.kind === "cat" && (
        <Field label={catalog.place.label} hint={catalog.place.required ? "Required" : "Optional"}>
          <Input
            value={parsed.place}
            onChange={(e) => onChange(catValue(parsed.key, e.target.value))}
            placeholder={catalog.place.placeholder}
            maxLength={80}
            autoFocus
          />
        </Field>
      )}
    </div>
  );
}
