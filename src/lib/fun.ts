import { differenceInCalendarDays, parseISO } from "date-fns";

/** Everyday things to put a lifted total in perspective ("you lifted a small car"). Weights in kilograms. */
const THINGS: { kg: number; emoji: string; one: string; many: string }[] = [
  { kg: 6, emoji: "🎳", one: "a bowling ball", many: "bowling balls" },
  { kg: 70, emoji: "🧍", one: "an adult", many: "adults" },
  { kg: 450, emoji: "🎹", one: "a grand piano", many: "grand pianos" },
  { kg: 1000, emoji: "🚗", one: "a small car", many: "small cars" },
  { kg: 1500, emoji: "🦛", one: "a hippo", many: "hippos" },
  { kg: 4000, emoji: "🐋", one: "a killer whale", many: "killer whales" },
  { kg: 5400, emoji: "🐘", one: "an elephant", many: "elephants" },
  { kg: 12000, emoji: "🚌", one: "a double-decker bus", many: "double-decker buses" },
  { kg: 150000, emoji: "🐳", one: "a blue whale", many: "blue whales" },
];

/** "That's about 3 small cars." for a total in kg; null when the total is too small to be fun. */
export function volumeComparison(totalKg: number): { emoji: string; text: string } | null {
  if (!Number.isFinite(totalKg) || totalKg < THINGS[0].kg) return null;
  let pick = THINGS[0];
  for (const t of THINGS) if (totalKg >= t.kg * 0.9) pick = t;
  const n = totalKg / pick.kg;
  if (n < 1.5) return { emoji: pick.emoji, text: `About the weight of ${pick.one}.` };
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 2) / 2;
  return { emoji: pick.emoji, text: `That's about ${rounded} ${pick.many}.` };
}

/** Whole days from today until a yyyy-MM-dd date (negative once it has passed); null for a missing or bad date. */
export function daysUntil(date: string | undefined, now: Date): number | null {
  if (!date) return null;
  const d = parseISO(date);
  if (Number.isNaN(d.getTime())) return null;
  return differenceInCalendarDays(d, now);
}
