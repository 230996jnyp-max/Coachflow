import type { UnitSystem } from "./types";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function uid(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`;
}

export const round = (n: number, d = 1) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/* ---------- Units ---------- */
const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

export const weightUnit = (u: UnitSystem) => (u === "metric" ? "kg" : "lbs");
export const lengthUnit = (u: UnitSystem) => (u === "metric" ? "cm" : "in");

export function fromKg(kg: number, u: UnitSystem): number {
  return u === "metric" ? kg : kg / KG_PER_LB;
}
export function toKg(v: number, u: UnitSystem): number {
  return u === "metric" ? v : v * KG_PER_LB;
}
export function fromCm(cm: number, u: UnitSystem): number {
  return u === "metric" ? cm : cm / CM_PER_IN;
}
export function toCm(v: number, u: UnitSystem): number {
  return u === "metric" ? v : v * CM_PER_IN;
}

export function fmtWeight(kg: number | undefined, u: UnitSystem, digits = 1): string {
  if (kg === undefined || Number.isNaN(kg)) return "—";
  return `${trim(round(fromKg(kg, u), digits))} ${weightUnit(u)}`;
}
export function fmtLength(cm: number | undefined, u: UnitSystem): string {
  if (cm === undefined || Number.isNaN(cm)) return "—";
  return `${trim(round(fromCm(cm, u), 1))} ${lengthUnit(u)}`;
}
export function fmtVolume(kg: number, u: UnitSystem): string {
  const v = fromKg(kg, u);
  return v >= 10000 ? `${round(v / 1000, 1)}k ${weightUnit(u)}` : `${Math.round(v).toLocaleString()} ${weightUnit(u)}`;
}

export function trim(n: number): string {
  return String(n);
}

/* ---------- Time ---------- */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const rr = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}

export function fmtDurationShort(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Parse "mm:ss", "h:mm:ss" or plain minutes ("20") into seconds. */
export function parseClock(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (t.includes(":")) {
    const parts = t.split(":").map((p) => Number(p));
    if (parts.some((p) => Number.isNaN(p))) return undefined;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const n = Number(t);
  if (Number.isNaN(n)) return undefined;
  return Math.round(n * 60);
}

/* ---------- Strength maths ---------- */
/** Epley estimated one-rep max. */
export function epley(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
