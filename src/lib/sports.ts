/** Sports, training disciplines, sub-categories and the joints / connective tissue tags. Shared by the app and the server. */

export const STRENGTH = "Strength & Gym";

/** The disciplines every coach starts with. A coach can add any other sport with AI. */
export const CORE_SPORTS = [
  STRENGTH,
  "Mobility & Flexibility",
  "Yoga & Mindful Movement",
  "Boxing & Combat Conditioning",
  "Swimming & Aquatics",
  "Basketball & Court Athletics",
  "Endurance & Conditioning",
] as const;

const SHORT: Record<string, string> = {
  [STRENGTH]: "Strength",
  "Mobility & Flexibility": "Mobility",
  "Yoga & Mindful Movement": "Yoga",
  "Boxing & Combat Conditioning": "Boxing",
  "Swimming & Aquatics": "Swimming",
  "Basketball & Court Athletics": "Basketball",
  "Endurance & Conditioning": "Endurance",
};

/** Short pill label ("Mobility"); sports added by a coach keep their own name. */
export const sportLabel = (sport: string): string => SHORT[sport] ?? sport;

export const SUB_CATEGORIES = ["Skill & Technique", "Footwork & Agility", "Sport Conditioning", "Mobility & Prehab"] as const;
export type SubCategory = (typeof SUB_CATEGORIES)[number];

export const JOINTS = ["Neck", "Shoulder", "Elbow", "Wrist", "Hip", "Knee", "Ankle", "Spine"] as const;
export const TISSUES = ["Rotator cuff", "Achilles tendon", "Patellar tendon", "ACL / MCL", "Plantar fascia", "IT band", "Hamstring tendon", "Hip flexor / psoas", "Wrist & forearm tendons"] as const;

/** Which joint each tendon / ligament sits at (so it can be shown on the body map). */
export const TISSUE_JOINT: Record<string, (typeof JOINTS)[number]> = {
  "Rotator cuff": "Shoulder",
  "Achilles tendon": "Ankle",
  "Patellar tendon": "Knee",
  "ACL / MCL": "Knee",
  "Plantar fascia": "Ankle",
  "IT band": "Knee",
  "Hamstring tendon": "Knee",
  "Hip flexor / psoas": "Hip",
  "Wrist & forearm tendons": "Wrist",
};

export const BASE_FOCUS = ["Upper Body", "Lower Body", "Full Body", "Cardio / HIIT", "Mobility & Form Check"];

/** A session's focus choices: the usual five plus the coach's own sports (e.g. "Boxing"). */
export function focusOptions(specialties: string[]): string[] {
  const extra = specialties.filter((s) => s !== STRENGTH && s !== "Mobility & Flexibility").map(sportLabel);
  return [...BASE_FOCUS, ...extra.filter((s, i) => !BASE_FOCUS.includes(s) && extra.indexOf(s) === i)];
}

/** Is this a focus the coach may use? (the usual five, or any sport the coach works with). */
export function focusAllowed(focus: string, sports: string[]): boolean {
  if (BASE_FOCUS.includes(focus)) return true;
  return [...CORE_SPORTS, ...sports].some((s) => s === focus || sportLabel(s) === focus);
}

export const disciplineOf = (ex: { discipline?: string }): string => ex.discipline || STRENGTH;

/** Cleans a list of sport names: trimmed, no duplicates, sensible length. */
export function cleanSports(list: unknown, max = 12): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string") continue;
    const s = v.replace(/\s+/g, " ").trim().slice(0, 50);
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
