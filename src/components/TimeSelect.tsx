"use client";

import { cn } from "@/lib/utils";
import { Select } from "./ui";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

/**
 * 24-hour time picker: one list for the hour (00–23) and one for the minute (00–59). Value is "HH:MM" (or "" when empty),
 * the same format a time input uses, so it can replace one directly.
 */
export function TimeSelect({ value, onChange, className, disabled, label = "Time" }: { value: string; onChange: (v: string) => void; className?: string; disabled?: boolean; label?: string }) {
  const [h, m] = /^\d{2}:\d{2}$/.test(value) ? value.split(":") : ["", ""];
  return (
    <div role="group" aria-label={label} className={cn("flex items-center gap-1.5", className)}>
      <Select aria-label={`${label} — hour`} disabled={disabled} value={h} onChange={(e) => onChange(`${e.target.value}:${m || "00"}`)} className="min-w-0 flex-1 pl-3 pr-7 text-center font-semibold tabular-nums">
        {!h && (
          <option value="" disabled>
            HH
          </option>
        )}
        {HOURS.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </Select>
      <span className="font-bold text-muted" aria-hidden>
        :
      </span>
      <Select aria-label={`${label} — minute`} disabled={disabled} value={m} onChange={(e) => onChange(`${h || "00"}:${e.target.value}`)} className="min-w-0 flex-1 pl-3 pr-7 text-center font-semibold tabular-nums">
        {!m && (
          <option value="" disabled>
            MM
          </option>
        )}
        {MINUTES.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </Select>
    </div>
  );
}
