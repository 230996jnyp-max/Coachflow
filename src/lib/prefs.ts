/*
 * Personal look and feel. Shared by the browser (to apply it) and the server (to validate it before saving), so it has no imports.
 * Stored as JSON in users.prefs. Nothing here is sensitive; the sealed profile stays for private data.
 */

export const ACCENTS = ["blue", "green", "orange", "purple", "pink", "red"] as const;
export type AccentId = (typeof ACCENTS)[number];
export const ACCENT_SWATCH: Record<AccentId, string> = { blue: "#3b82f6", green: "#10b981", orange: "#f97316", purple: "#8b5cf6", pink: "#ec4899", red: "#ef4444" };

export const TEXT_SIZES = ["normal", "large", "xl"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

/** Ready-made backgrounds (CSS, so nothing is downloaded). "custom" means the person's own picture. */
export const BACKGROUNDS: { id: string; label: string; css: string }[] = [
  { id: "none", label: "None", css: "" },
  { id: "aurora", label: "Aurora", css: "radial-gradient(80% 60% at 15% 10%, rgba(59,130,246,.35), transparent 60%), radial-gradient(70% 60% at 90% 20%, rgba(139,92,246,.30), transparent 60%), radial-gradient(80% 70% at 50% 100%, rgba(16,185,129,.22), transparent 60%)" },
  { id: "sunset", label: "Sunset", css: "radial-gradient(90% 60% at 80% 0%, rgba(249,115,22,.38), transparent 60%), radial-gradient(80% 70% at 0% 100%, rgba(236,72,153,.30), transparent 60%)" },
  { id: "ocean", label: "Ocean", css: "radial-gradient(90% 60% at 0% 0%, rgba(14,165,233,.38), transparent 60%), radial-gradient(80% 70% at 100% 100%, rgba(20,184,166,.28), transparent 60%)" },
  { id: "forest", label: "Forest", css: "radial-gradient(90% 70% at 100% 0%, rgba(16,185,129,.32), transparent 60%), radial-gradient(70% 60% at 0% 100%, rgba(132,204,22,.22), transparent 60%)" },
  { id: "ember", label: "Ember", css: "radial-gradient(90% 60% at 50% 0%, rgba(239,68,68,.34), transparent 60%), radial-gradient(70% 60% at 100% 100%, rgba(245,158,11,.24), transparent 60%)" },
  { id: "violet", label: "Violet", css: "radial-gradient(90% 60% at 100% 0%, rgba(139,92,246,.38), transparent 60%), radial-gradient(70% 60% at 0% 100%, rgba(236,72,153,.22), transparent 60%)" },
  { id: "grid", label: "Grid", css: "linear-gradient(rgba(148,163,184,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.10) 1px, transparent 1px)" },
  { id: "carbon", label: "Carbon", css: "repeating-linear-gradient(45deg, rgba(148,163,184,.07) 0 2px, transparent 2px 8px)" },
  { id: "mist", label: "Mist", css: "linear-gradient(180deg, rgba(148,163,184,.16), transparent 55%)" },
];
export const BACKGROUND_IDS = [...BACKGROUNDS.map((b) => b.id), "custom"];

/** Home-screen sections a person can hide or reorder. Each page knows which of these it has. */
export const HOME_SECTIONS: Record<"client" | "coach", { id: string; label: string }[]> = {
  client: [
    { id: "assigned", label: "Today's workout" },
    { id: "next", label: "Next session" },
    { id: "goal", label: "Goal countdown" },
    { id: "classes", label: "Group classes" },
    { id: "numbers", label: "This week in numbers" },
    { id: "start", label: "Quick start" },
    { id: "records", label: "Latest records" },
    { id: "recent", label: "Recent workouts" },
  ],
  coach: [
    { id: "needs", label: "Who needs attention" },
    { id: "requests", label: "Client requests and your code" },
    { id: "activity", label: "Activity and attendance" },
    { id: "bookings", label: "Booking requests" },
    { id: "today", label: "Today's sessions" },
    { id: "low", label: "Low on credits" },
    { id: "recent", label: "Recent client workouts" },
  ],
};

export interface Prefs {
  accent?: AccentId;
  bg?: string;
  /** 0 to 100: how much the background is covered by the theme colour (higher = calmer). */
  bgDim?: number;
  textSize?: TextSize;
  density?: Density;
  /** Notifications stay quiet between these two local times ("22:00" to "07:00"). */
  quiet?: { from: string; to: string } | null;
  /** Confetti and milestone animations (on unless false). */
  celebrate?: boolean;
  home?: { client?: { hidden: string[]; order: string[] }; coach?: { hidden: string[]; order: string[] } };
  /** Shown to the people they train with (or their coach). */
  bio?: string;
  nick?: string;
  /** Bumped each time a picture is uploaded, so the browser fetches the new one. 0/absent = none. */
  avatarV?: number;
  bgV?: number;
  bannerV?: number;
  logoV?: number;
}

/** The part other people may see (their coach / clients). */
export const PUBLIC_KEYS = ["bio", "nick", "avatarV", "bannerV", "logoV"] as const;

export const MEDIA_KINDS = ["avatar", "bg", "banner", "logo"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const VERSION_KEY: Record<MediaKind, "avatarV" | "bgV" | "bannerV" | "logoV"> = { avatar: "avatarV", bg: "bgV", banner: "bannerV", logo: "logoV" };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Picks the known, valid fields out of anything sent in. Unknown or invalid values are dropped, never trusted. */
export function cleanPrefs(raw: unknown): Prefs {
  const out: Prefs = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if ((ACCENTS as readonly string[]).includes(r.accent as string)) out.accent = r.accent as AccentId;
  if (typeof r.bg === "string" && BACKGROUND_IDS.includes(r.bg)) out.bg = r.bg;
  if (typeof r.bgDim === "number" && Number.isFinite(r.bgDim)) out.bgDim = Math.min(90, Math.max(0, Math.round(r.bgDim)));
  if ((TEXT_SIZES as readonly string[]).includes(r.textSize as string)) out.textSize = r.textSize as TextSize;
  if ((DENSITIES as readonly string[]).includes(r.density as string)) out.density = r.density as Density;
  if (r.quiet === null) out.quiet = null;
  else if (r.quiet && typeof r.quiet === "object") {
    const q = r.quiet as Record<string, unknown>;
    if (typeof q.from === "string" && typeof q.to === "string" && TIME.test(q.from) && TIME.test(q.to)) out.quiet = { from: q.from, to: q.to };
  }
  if (typeof r.celebrate === "boolean") out.celebrate = r.celebrate;
  if (typeof r.bio === "string") out.bio = r.bio.trim().slice(0, 140);
  if (typeof r.nick === "string") out.nick = r.nick.trim().slice(0, 30);
  for (const k of ["avatarV", "bgV", "bannerV", "logoV"] as const) if (typeof r[k] === "number" && Number.isFinite(r[k])) out[k] = Math.max(0, Math.floor(r[k] as number));
  if (r.home && typeof r.home === "object" && !Array.isArray(r.home)) {
    const h = r.home as Record<string, unknown>;
    const home: NonNullable<Prefs["home"]> = {};
    for (const side of ["client", "coach"] as const) {
      const v = h[side] as { hidden?: unknown; order?: unknown } | undefined;
      if (!v || typeof v !== "object") continue;
      const ids = new Set(HOME_SECTIONS[side].map((s) => s.id));
      const list = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter((i): i is string => typeof i === "string" && ids.has(i)))] : []);
      home[side] = { hidden: list(v.hidden), order: list(v.order) };
    }
    out.home = home;
  }
  return out;
}

export function parsePrefs(json: string | null | undefined): Prefs {
  if (!json) return {};
  try {
    return cleanPrefs(JSON.parse(json));
  } catch {
    return {};
  }
}

/** The fields everyone who works with this person may see. */
export function publicPrefs(p: Prefs): Pick<Prefs, (typeof PUBLIC_KEYS)[number]> {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_KEYS) if (p[k] !== undefined && p[k] !== "" && p[k] !== 0) out[k] = p[k];
  return out;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** Is `now` inside the person's quiet hours (which may run past midnight)? */
export function inQuietHours(q: Prefs["quiet"], now: Date): boolean {
  if (!q) return false;
  const from = minutes(q.from), to = minutes(q.to), cur = now.getHours() * 60 + now.getMinutes();
  if (from === to) return false;
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

/** Sort `items` by the saved order (unknown ones last, in their original order) and drop the hidden ones. */
export function arrange<T extends { id: string }>(items: T[], setting: { hidden: string[]; order: string[] } | undefined): T[] {
  if (!setting) return items;
  const rank = (id: string) => {
    const i = setting.order.indexOf(id);
    return i === -1 ? 1000 : i;
  };
  return items.filter((i) => !setting.hidden.includes(i.id)).sort((a, b) => rank(a.id) - rank(b.id));
}

/** The picture web address for a person's photo, or null when they have none. */
export const mediaUrl = (userId: string, kind: MediaKind, v: number | undefined): string | null => (v ? `/api/media/${encodeURIComponent(userId)}/${kind}?v=${v}` : null);
