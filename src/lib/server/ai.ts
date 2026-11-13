import "server-only";
import { EQUIPMENT, MUSCLES } from "@/data/exercises";
import { JOINTS, SUB_CATEGORIES, TISSUES } from "@/lib/sports";
import { fallbackType, sanitizeTracking } from "@/lib/tracking";
import type { Equipment, MeasureType, MuscleGroup, TrackingSchema } from "@/lib/types";
import { buildIndex, matchExercise } from "../exerciseMatch";
import { groqKeys, orderKeys } from "./aiKeys";
import type { ParsedExercise, ParsedSet, ParsedWorkout } from "../workoutText";
import { HttpError } from "./http";

/*
 * AI workout reading via Groq's OpenAI-compatible API (keys: GROQ_API_KEYS and/or GROQ_API_KEY, server only; see aiKeys.ts).
 *  - gpt-oss-120b turns messy notes into structured workouts mapped onto the exercise library.
 *  - qwen3.8-27b (vision) transcribes photos / scanned pages into text first.
 * Everything the model returns is re-validated field by field; if anything fails the caller falls back to the local parser.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const TEXT_MODEL = "openai/gpt-oss-120b";
export const VISION_MODEL = "qwen/qwen3.8-27b";
const KG_PER_LB = 0.45359237;

export const aiConfigured = () => groqKeys().length > 0;

interface ChatBody {
  model: string;
  messages: unknown[];
  [k: string]: unknown;
}

// Keys that were rate-limited or rejected are set aside for a while (per server instance).
const coolUntil = new Map<string, number>();
let cursor = Math.floor(Math.random() * 1000);

export async function groq(body: ChatBody, timeoutMs: number): Promise<string> {
  const keys = groqKeys();
  if (keys.length === 0) throw new HttpError(503, "AI reading isn't set up.");
  const send = (key: string) =>
    fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

  let sawRateLimit = false;
  // Up to two passes: if every key is busy, waiting for the soonest one to free up (up to 30 s) beats failing.
  for (let pass = 0; pass < 2; pass++) {
    for (const key of orderKeys(keys, coolUntil, Date.now(), cursor++)) {
      let res: Response;
      try {
        res = await send(key);
      } catch (e) {
        if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new HttpError(504, "The AI took too long to answer.");
        continue; // couldn't reach Groq with this attempt: try the next key
      }
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
        const content = data?.choices?.[0]?.message?.content;
        if (!content) throw new HttpError(503, "The AI returned an empty answer.");
        return content;
      }
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      if (res.status === 429) {
        sawRateLimit = true;
        const wait = Number(res.headers.get("retry-after"));
        coolUntil.set(key, Date.now() + (wait > 0 ? Math.min(wait, 60) * 1000 : 20_000));
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        console.error("Groq key rejected", res.status); // never log the key or provider details
        coolUntil.set(key, Date.now() + 30 * 60_000);
        continue;
      }
      if (res.status >= 500) {
        coolUntil.set(key, Date.now() + 5_000);
        continue;
      }
      // Any other answer is about the request itself, so another key would not help.
      console.error("Groq error", res.status, detail.slice(0, 200));
      throw new HttpError(503, "The AI service is unavailable right now.");
    }
    if (pass === 0) {
      const soonest = Math.min(...keys.map((k) => coolUntil.get(k) ?? 0)) - Date.now();
      if (!sawRateLimit || soonest > 30_000) break; // Groq frees a key within a minute at most; waiting beats failing
      await new Promise((r) => setTimeout(r, Math.max(soonest, 0) + 250));
    }
  }
  throw new HttpError(sawRateLimit ? 429 : 503, sawRateLimit ? "The AI is busy right now. Try again in a minute." : "The AI service is unavailable right now.");
}

/* ---------------- Photos and scans -> text ---------------- */
export const DATA_URL = /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_IMAGE_DATA_URL = 3_800_000;

export async function transcribeImages(images: string[]): Promise<string> {
  const pages: string[] = [];
  for (const url of images.slice(0, 4)) {
    if (!DATA_URL.test(url) || url.length > MAX_IMAGE_DATA_URL) throw new HttpError(415, "That image is too large or in an unsupported format. Use a JPG or PNG under about 3 MB.");
    const text = await groq(
      {
        model: VISION_MODEL,
        temperature: 0,
        max_completion_tokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "This is a photo or scan of a workout plan or training log. Transcribe ALL the text exactly as written, line by line, keeping the original order, numbers, units, abbreviations and any dates. " +
                  "If it is a table, write each row on one line with columns separated by ' | ' and keep the header row. " +
                  "Do not summarise, correct or add anything. Output only the transcription.",
              },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      },
      60_000,
    );
    pages.push(text.trim());
  }
  return pages.filter(Boolean).join("\n\n");
}

/* ---------------- Text -> structured workouts ---------------- */
export interface LibraryEntry {
  id: string;
  name: string;
}

export interface AiReadInput {
  text: string;
  unit: "metric" | "imperial";
  today: string;
  library: LibraryEntry[];
}

const SYSTEM = `You are an expert strength & conditioning coach's assistant. You read a personal trainer's raw workout notes (typed, pasted from WhatsApp/Notes, or transcribed from a photo) and convert them into structured JSON. The notes are often messy, use shorthand, and mix several days.

Return ONLY one JSON object, no commentary, with this shape:
{"workouts":[{
  "title": string,                      // e.g. "Push Day A"; "" if none is written
  "date": "YYYY-MM-DD" | null,          // ONLY if a date is actually written for this workout
  "notes": string,                      // workout-level notes, "" if none
  "exercises":[{
    "name": string,                     // the exercise exactly as the coach wrote it
    "libraryIndex": integer | null,     // index of the closest exercise in the LIBRARY list, or null if nothing fits
    "confidence": "high" | "medium" | "low",
    "superset": string | null,          // same label (e.g. "A") on exercises performed as a superset / giant set / circuit
    "notes": string,                    // rest times, tempo, cues, "each side", "slow negatives"... "" if none
    "repMin": integer | null, "repMax": integer | null,   // when a rep RANGE is written (8-10 -> 8 and 10)
    "sets":[{
      "type": "N" | "W" | "D" | "F",    // N working, W warm-up, D drop set, F set taken to failure
      "reps": integer | null,           // for a rep range use the UPPER number; null for AMRAP / unknown
      "weight": number | null, "unit": "kg" | "lb" | null,   // load as written; unit null if not written
      "durationSec": integer | null, "distanceKm": number | null,
      "rpe": number | null
    }]
  }]
}]}

Rules:
- Expand sets individually: "4x8-10 @ 30kg" = four set objects, each reps 10, weight 30, unit "kg", with repMin 8 and repMax 10 on the exercise. "3x10" = three sets of 10 with weight null.
- Pyramids / different loads per set ("60x10, 70x8, 80x6", "10@60, 8@70") = one set object per entry. Weight written before "x" is the load; "x" followed by a number is reps.
- Warm-up sets ("2 warm up sets", "WU 40x10") are type "W" and come before the working sets. "Drop set" -> "D". "to failure" / "AMRAP" -> type "F" (reps null if unknown). Do not invent sets that are not implied.
- Cardio and timed work ("Treadmill 20 mins", "5km run in 28:30", "plank 3x45s", "bike 10 x 30s on / 30s off"): put time in durationSec and distance in distanceKm (convert miles to km); a repeated hold is one set object per round.
- Rest times ("rest 90s", "2 min rest"), tempo ("3-1-1"), RIR, cues and side notes go in the exercise "notes" as short text, e.g. "Rest 90s; tempo 3-1-1".
- NOTHING written on an exercise line may be lost: anything the fields above cannot hold (incline / speed / resistance level, "per leg" / "each side", grip, interval structure such as "30s on / 30s off", "slow negatives", brand/machine names) MUST be kept in "notes".
- Supersets / circuits ("SS:", "A1/A2", "superset", "+" between exercises): give the grouped exercises the same "superset" label and keep their written order.
- Several days or workouts ("Day 1/Day 2", "Push / Pull", headings, dates) = separate workouts. If nothing separates them, return one workout.
- Abbreviations: DB = dumbbell, BB = barbell, KB = kettlebell, BW = bodyweight, OHP = overhead press, RDL = Romanian deadlift, SLDL = stiff-leg deadlift, BP = bench press, DL = deadlift, SQ = squat, CGBP = close-grip bench press, GHR = glute-ham raise, T-bar, "pulldown", "pull-ups/chin-ups" etc. If no equipment is written, prefer the barbell version for compound barbell lifts and the most common version otherwise.
- Ambiguous names mean the most common gym movement: "curls" = biceps curls (NOT leg curls unless "leg", "hamstring" or "lying/seated leg" is written), "extensions" = triceps extensions unless "leg" or "back" is written, "raises" = the deltoid raise unless "calf", "leg" or "hip" is written, "rows" = back rows, "press" with no other word = barbell bench press only if the day is push/chest, otherwise overhead press. When a name is still ambiguous, lower the confidence to "medium".
- libraryIndex must come from the LIBRARY list below. Pick the closest real movement; use null (never guess) when nothing fits. "high" = exact movement and equipment, "medium" = same movement but equipment/variation uncertain, "low" = a guess.
- Dates: only when written. Read day-first (12/10 = 12 October). With no year use the nearest one to TODAY.
- Weights with no unit: leave "unit" null. Never convert units yourself.
- Do not output anything that is not in the notes. If a line is not an exercise (greeting, chatter), ignore it.`;

const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = num(v, min, max);
  return n === undefined ? undefined : Math.round(n);
};
const txt = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function isRealDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 2000 && y <= 2100;
}

export function jsonFrom(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? t.slice(start, end + 1) : t);
}

const SET_TYPES = new Set(["N", "W", "D", "F"]);

export function sanitizeAiWorkouts(raw: unknown, library: LibraryEntry[], unit: "metric" | "imperial"): ParsedWorkout[] {
  const root = raw as { workouts?: unknown };
  if (!root || !Array.isArray(root.workouts)) throw new HttpError(502, "The AI answer wasn't in the expected format.");
  const out: ParsedWorkout[] = [];
  for (const w of root.workouts.slice(0, 14)) {
    const wk = w as Record<string, unknown>;
    if (!wk || !Array.isArray(wk.exercises)) continue;
    const exercises: ParsedExercise[] = [];
    for (const e of wk.exercises.slice(0, 60)) {
      const ex = e as Record<string, unknown>;
      const name = txt(ex?.name, 120);
      if (!name) continue;
      const sets: ParsedSet[] = [];
      for (const s of (Array.isArray(ex.sets) ? ex.sets : []).slice(0, 40)) {
        const st = s as Record<string, unknown>;
        const set: ParsedSet = {};
        const type = typeof st.type === "string" && SET_TYPES.has(st.type) ? (st.type as ParsedSet["type"]) : "N";
        if (type !== "N") set.type = type;
        const reps = int(st.reps, 1, 1000);
        const weight = num(st.weight, 0.01, 2000);
        const dur = int(st.durationSec, 1, 172800);
        const dist = num(st.distanceKm, 0.001, 5000);
        const rpe = num(st.rpe, 1, 10);
        if (reps !== undefined) set.reps = reps;
        if (weight !== undefined) {
          const lb = st.unit === "lb" || (st.unit !== "kg" && unit === "imperial");
          set.weightKg = Math.round((lb ? weight * KG_PER_LB : weight) * 100) / 100;
        }
        if (dur !== undefined) set.durationSec = dur;
        if (dist !== undefined) set.distanceKm = Math.round(dist * 1000) / 1000;
        if (rpe !== undefined) set.rpe = rpe;
        sets.push(set);
      }
      const repMin = int(ex.repMin, 1, 1000);
      const repMax = int(ex.repMax, 1, 1000);
      const idx = int(ex.libraryIndex, 0, library.length - 1);
      const conf = ex.confidence === "high" || ex.confidence === "medium" ? ex.confidence : "low";
      const superset = txt(ex.superset, 12);
      const notes = [txt(ex.notes, 300), superset ? `Superset ${superset}` : ""].filter(Boolean).join("; ");
      const reps = sets.map((s) => s.reps).filter((n): n is number => n !== undefined);
      const parsed: ParsedExercise = {
        raw: name,
        sets: sets.length ? sets : [{ reps: 10 }, { reps: 10 }, { reps: 10 }],
        repMin: repMin ?? (reps.length ? Math.min(...reps) : sets.length ? undefined : 8),
        repMax: repMax ?? (reps.length ? Math.max(...reps) : sets.length ? undefined : 12),
        notes,
        timed: sets.some((s) => s.durationSec || s.distanceKm),
        noSets: sets.length === 0,
      };
      if (idx !== undefined && conf !== "low") {
        parsed.libraryId = library[idx].id;
        parsed.libraryConfidence = conf;
      }
      exercises.push(parsed);
    }
    if (!exercises.length) continue;
    out.push({ title: txt(wk.title, 120), date: isRealDate(wk.date) ? wk.date : undefined, notes: txt(wk.notes, 1000), exercises });
  }
  if (!out.length) throw new HttpError(422, "The AI couldn't find any exercises in that text.");
  return out;
}

/**
 * The whole library is ~5,000 tokens, which is slow and wastes the provider's per-minute limit. Instead each line of the
 * notes is matched locally and only the likely candidates (plus a few extra per line) are shown to the AI.
 */
export function shortlistLibrary(text: string, library: LibraryEntry[], perLine = 8): LibraryEntry[] {
  const index = buildIndex(library.map((e) => ({ id: e.id, name: e.name, primary: "Chest", secondary: [], equipment: "Other", type: "WEIGHT_REPS" })));
  const byId = new Map(library.map((e) => [e.id, e]));
  const picked = new Set<string>();
  for (const line of text.split(/\r?\n/).slice(0, 400)) {
    for (const part of line.split(/\s\/\s|\s\+\s|&|\bthen\b|;/i)) {
      const words = part.replace(/[^A-Za-z' -]+/g, " ").replace(/\s+/g, " ").trim();
      if (words.length < 3) continue;
      for (const c of matchExercise(words, index).suggestions.slice(0, perLine)) picked.add(c.id);
    }
  }
  const out = [...picked].map((id) => byId.get(id)).filter((e): e is LibraryEntry => !!e);
  // Tiny or unusual notes: fall back to a broad slice so the AI still has something to choose from.
  return out.length >= 12 ? out : library.slice(0, 140);
}

export async function aiReadWorkouts(input: AiReadInput): Promise<ParsedWorkout[]> {
  const libraryList = input.library.map((e, i) => `${i}|${e.name}`).join("\n");
  const content = await groq(
    {
      model: TEXT_MODEL,
      temperature: 0,
      reasoning_effort: "medium",
      max_completion_tokens: 16000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${SYSTEM}\n\nLIBRARY (index|name):\n${libraryList}` },
        {
          role: "user",
          content: `TODAY: ${input.today}\nWeights with no unit are in ${input.unit === "imperial" ? "lb" : "kg"} (still leave "unit" null).\n\nNOTES:\n"""\n${input.text.slice(0, 20000)}\n"""`,
        },
      ],
    },
    55_000,
  );
  let parsed: unknown;
  try {
    parsed = jsonFrom(content);
  } catch {
    throw new HttpError(502, "The AI answer couldn't be read.");
  }
  return sanitizeAiWorkouts(parsed, input.library, input.unit);
}

/* ---------------- Sports: drills for any sport, and custom tracking formats ---------------- */
export interface GeneratedExercise {
  name: string;
  subCategory: string;
  primary: MuscleGroup;
  secondary: MuscleGroup[];
  equipment: Equipment;
  /** Classic measurement (weight x reps, bodyweight reps ...) used when there is no custom set table. */
  type: MeasureType;
  /** Custom set-table columns; null for plain lifts that use `type` as it is. */
  tracking: TrackingSchema | null;
  joints: string[];
  tissues: string[];
}

const MEASURE_CODES: Record<string, MeasureType> = {
  WR: "WEIGHT_REPS",
  BW: "BODYWEIGHT_REPS",
  WB: "WEIGHTED_BODYWEIGHT",
  DD: "DURATION_DISTANCE",
  DO: "DURATION_ONLY",
};

const PRESET_HELP = `hold = Hold time (seconds); hold_side = Hold time + side (Both/Left/Right); reps = Reps; reps_side = Reps + side;
flow = Rounds + Time (flows, ladders, rope); rounds = Rounds + Round length + Rest (+ total time) for combat / bag / pad work;
swim = Stroke + Distance (m) + Time + Pace per 100 m; shooting = Spot + Made + Attempted + Shooting %;
timed = Reps + Time (timed skill drills); interval = Reps + Distance (m) + Time (sprints, runs, sled).`;

const COLUMN_HELP = `A custom tracking format is {"columns":[...],"primary":"<column key>"}. Each column:
{"key":"snake_case","label":"Short Label","kind":"number"|"duration"|"text"|"select"|"computed",
 "unit":"optional e.g. m, kg, %","options":["only for select, 2-8 choices"],
 "agg":"sum"|"max"|"avg"|"last"  (how the sets of one session combine for the progress chart; counts/distances sum, holds max, rest/round times avg),
 "op":"ratio_pct"|"ratio"|"per100"|"sum"|"avg"|"product","of":["keys of two or more number/duration columns"] (only for computed)}.
"duration" values are in seconds and shown as mm:ss. computed ops: ratio_pct = of[0]/of[1]*100 (e.g. shooting %); ratio = of[0]/of[1]; per100 = of[0]/of[1]*100 (e.g. pace per 100 m from time and distance);
sum / avg / product combine 2-4 columns. At most 7 columns. "primary" is the column to chart (a number, duration or computed column).`;

const SPORT_SYSTEM = `You are an expert strength & conditioning and skills coach with deep knowledge of many sports. For the sport or training discipline you are given, design exercises and drills that make athletes BETTER AT THAT SPORT, not just generic gym lifts: technique and skill drills, footwork and agility, sport-specific conditioning, and mobility / injury-prevention work for the joints and tissues that sport stresses.

Return ONLY one JSON object, no commentary:
{"sport":"<the sport's proper name, 1-4 words>","exercises":[{
  "name":"<distinctive drill name, max 60 chars>",
  "subCategory": one of ${JSON.stringify(SUB_CATEGORIES)},
  "primary": one of ${JSON.stringify(MUSCLES)}   (the main muscle group worked; use "Full Body" or "Cardio" when it fits),
  "secondary": [muscle groups from the same list],
  "equipment": one of ${JSON.stringify(EQUIPMENT)}   (pick the closest; "Other" if none fit),
  "tracking": {"preset":"<preset id>"} OR a custom format OR, for ordinary lifts and bodyweight moves, {"measure":"WR"|"BW"|"WB"|"DD"|"DO"}   (WR = weight x reps, BW = bodyweight reps, WB = weighted bodyweight reps, DD = distance + time, DO = time only),
  "joints": [from ${JSON.stringify(JOINTS)}]   (0-2: only the joints the drill mainly loads or protects; leave [] for most skill drills),
  "tissues": [from ${JSON.stringify(TISSUES)}]   (0-1: only for prehab / injury-prevention work aimed at a specific tendon or ligament; otherwise [])
}]}

Tracking presets (use one whenever it fits the drill): ${PRESET_HELP}
${COLUMN_HELP}
Lifting-style disciplines (powerlifting, weightlifting, calisthenics, strongman) should mostly use {"measure":"WR"} / "BW" / "WB". Vary grips, stances, tempos, ranges of motion, equipment and difficulty levels so the list stays rich without repeating itself.
Pick the tracking that a coach would actually record for that drill (e.g. shooting drills: made / attempted; swim sets: distance and time; holds: seconds; combat rounds: rounds and round length).
Cover ALL four sub-categories with a sensible mix. No duplicates and nothing from the EXISTING list. Only real, well-known drills; do not invent equipment the sport does not use.`;

export interface SportInput {
  sport: string;
  count: number;
  existing: string[];
  subCategory?: string;
}

function muscleList(v: unknown, not?: string): MuscleGroup[] {
  return (Array.isArray(v) ? v : []).filter((m): m is MuscleGroup => typeof m === "string" && (MUSCLES as string[]).includes(m) && m !== not).slice(0, 6);
}

export function sanitizeGeneratedExercises(raw: unknown, sport: string, existing: string[]): { sport: string; exercises: GeneratedExercise[] } {
  const root = raw as { sport?: unknown; exercises?: unknown };
  if (!root || !Array.isArray(root.exercises)) throw new HttpError(502, "The AI answer wasn't in the expected format.");
  const taken = new Set(existing.map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "")));
  const out: GeneratedExercise[] = [];
  for (const item of root.exercises.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const x = item as Record<string, unknown>;
    const name = typeof x.name === "string" ? x.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!name || taken.has(key)) continue;
    const rawT = x.tracking as { measure?: unknown } | null | undefined;
    let measure = rawT && typeof rawT === "object" && typeof rawT.measure === "string" ? MEASURE_CODES[rawT.measure.toUpperCase()] : undefined;
    // A reviewed drill sent back by the app: no custom columns, just its classic measurement.
    if (!measure && rawT == null && Object.values(MEASURE_CODES).includes(x.type as MeasureType)) measure = x.type as MeasureType;
    const t = measure ? null : sanitizeTracking(x.tracking);
    if (!measure && !t?.ok) continue;
    taken.add(key);
    const primary = (MUSCLES as string[]).includes(x.primary as string) ? (x.primary as MuscleGroup) : "Full Body";
    const schema = t?.ok ? t.schema : null;
    out.push({
      name,
      subCategory: (SUB_CATEGORIES as readonly string[]).includes(x.subCategory as string) ? (x.subCategory as string) : "Skill & Technique",
      primary,
      secondary: muscleList(x.secondary, primary),
      equipment: (EQUIPMENT as string[]).includes(x.equipment as string) ? (x.equipment as Equipment) : "Other",
      type: measure ?? (schema ? fallbackType(schema) : "WEIGHT_REPS"),
      tracking: schema,
      joints: (Array.isArray(x.joints) ? x.joints : []).filter((j): j is string => typeof j === "string" && (JOINTS as readonly string[]).includes(j)).slice(0, 2),
      tissues: (Array.isArray(x.tissues) ? x.tissues : []).filter((j): j is string => typeof j === "string" && (TISSUES as readonly string[]).includes(j)).slice(0, 1),
    });
  }
  const name = typeof root.sport === "string" && root.sport.trim() ? root.sport.replace(/\s+/g, " ").trim().slice(0, 50) : sport;
  if (out.length === 0) throw new HttpError(502, "The AI didn't return any usable exercises. Try again or rephrase the sport.");
  return { sport: name, exercises: out };
}

/** Sport-specific drills for any sport (technique, footwork, conditioning, mobility), each with a sensible tracking format. */
export async function aiSportExercises(input: SportInput): Promise<{ sport: string; exercises: GeneratedExercise[] }> {
  const content = await groq(
    {
      model: TEXT_MODEL,
      temperature: 0.4,
      reasoning_effort: "low",
      max_completion_tokens: Math.min(12000, 1800 + input.count * 170),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SPORT_SYSTEM },
        {
          role: "user",
          content:
            `SPORT / DISCIPLINE: ${input.sport}\nHOW MANY: ${input.count}\n` +
            (input.subCategory ? `FOCUS ON SUB-CATEGORY: ${input.subCategory} (but still add a few from the others)\n` : "") +
            `EXISTING (do not repeat): ${input.existing.slice(0, 120).join("; ") || "none"}`,
        },
      ],
    },
    55_000,
  );
  let parsed: unknown;
  try {
    parsed = jsonFrom(content);
  } catch {
    throw new HttpError(502, "The AI answer couldn't be read.");
  }
  return sanitizeGeneratedExercises(parsed, input.sport, input.existing);
}

const TRACKING_SYSTEM = `You turn a personal trainer's plain-English request into a tracking format for ONE exercise: the columns the client fills in for every set, and the single value that is charted in the client's progress.

Return ONLY one JSON object, no commentary:
{"columns":[...],"primary":"<key of the column to chart>","summary":"<one short sentence saying what will be tracked and charted>"}

${COLUMN_HELP}
Use exactly the columns the coach asked for (plus a computed column when they ask for a percentage, pace, total or ratio). Choose the chart ("primary") the coach asks for; otherwise the most meaningful value. Preset formats are examples of good designs: ${PRESET_HELP}`;

export interface TrackingInput {
  exerciseName: string;
  sport?: string;
  instruction: string;
  current?: TrackingSchema;
}

export async function aiCustomTracking(input: TrackingInput): Promise<{ tracking: TrackingSchema; summary: string }> {
  const content = await groq(
    {
      model: TEXT_MODEL,
      temperature: 0.2,
      reasoning_effort: "low",
      max_completion_tokens: 3000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: TRACKING_SYSTEM },
        {
          role: "user",
          content: `EXERCISE: ${input.exerciseName}\nSPORT: ${input.sport || "general"}\nCURRENT FORMAT: ${input.current ? JSON.stringify(input.current) : "weight x reps (default)"}\n\nCOACH'S REQUEST:\n"""\n${input.instruction.slice(0, 600)}\n"""`,
        },
      ],
    },
    40_000,
  );
  let parsed: unknown;
  try {
    parsed = jsonFrom(content);
  } catch {
    throw new HttpError(502, "The AI answer couldn't be read.");
  }
  const t = sanitizeTracking(parsed);
  if (!t.ok) throw new HttpError(502, "The AI couldn't build that tracking format. Try describing the columns more simply.");
  const summary = typeof (parsed as { summary?: unknown }).summary === "string" ? (parsed as { summary: string }).summary.slice(0, 240) : "";
  return { tracking: t.schema, summary };
}

/* ---------------- Starter routines for a niche ---------------- */
export interface GeneratedRoutine {
  name: string;
  exercises: { exerciseId: string; sets: number; repMin: number; repMax: number; durationSec?: number }[];
}

const ROUTINE_SYSTEM = `You are an expert coach designing STARTER WORKOUT ROUTINES for a coach who specialises in one niche. Use ONLY exercises from the AVAILABLE list, copied exactly as written.

Return ONLY one JSON object, no commentary:
{"routines":[{"name":"<routine name, max 50 chars>","exercises":[{"name":"<exact name from AVAILABLE>","sets":<1-8>,"repMin":<number>,"repMax":<number>,"durationSec":<optional seconds for holds / timed work>}]}]}

Each routine has 5-9 exercises in a sensible order (warm-up / skill, main work, conditioning or accessories, cool-down where it fits) and a distinct purpose, e.g. a push day vs a pull day, or a 60-minute flow vs a hip opener. For drills that are held or timed use repMin and repMax 0 and set durationSec. Otherwise give a realistic rep range.`;

/** 3-5 ready-to-use routines built only from real library exercises. `library` is name -> id. */
export async function aiNicheRoutines(niche: string, library: { id: string; name: string }[], count: number): Promise<GeneratedRoutine[]> {
  const content = await groq(
    {
      model: TEXT_MODEL,
      temperature: 0.5,
      reasoning_effort: "low",
      max_completion_tokens: 6000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ROUTINE_SYSTEM },
        { role: "user", content: ["NICHE: " + niche, "HOW MANY ROUTINES: " + count, "AVAILABLE:", ...library.map((e) => e.name)].join(String.fromCharCode(10)) },
      ],
    },
    55_000,
  );
  let parsed: unknown;
  try {
    parsed = jsonFrom(content);
  } catch {
    throw new HttpError(502, "The AI answer couldn't be read.");
  }
  return sanitizeRoutines(parsed, library);
}

export function sanitizeRoutines(raw: unknown, library: { id: string; name: string }[]): GeneratedRoutine[] {
  const root = raw as { routines?: unknown };
  if (!root || !Array.isArray(root.routines)) throw new HttpError(502, "The AI answer wasn't in the expected format.");
  const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byName = new Map(library.map((e) => [norm(e.name), e.id]));
  const out: GeneratedRoutine[] = [];
  for (const item of root.routines.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const r = item as { name?: unknown; exercises?: unknown };
    const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, 50) : "";
    if (!name || !Array.isArray(r.exercises)) continue;
    const seen = new Set<string>();
    const exercises: GeneratedRoutine["exercises"] = [];
    for (const e of r.exercises.slice(0, 12)) {
      if (!e || typeof e !== "object") continue;
      const x = e as Record<string, unknown>;
      const exId = typeof x.name === "string" ? byName.get(norm(x.name)) : undefined;
      if (!exId || seen.has(exId)) continue;
      seen.add(exId);
      const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
      const repMin = num(x.repMin, 0, 200, 0);
      const repMax = Math.max(repMin, num(x.repMax, 0, 200, repMin));
      const durationSec = num(x.durationSec, 0, 7200, 0);
      exercises.push({ exerciseId: exId, sets: num(x.sets, 1, 8, 3), repMin, repMax, ...(durationSec > 0 ? { durationSec } : {}) });
    }
    if (exercises.length >= 4 && !out.some((o) => norm(o.name) === norm(name))) out.push({ name, exercises });
  }
  if (out.length === 0) throw new HttpError(502, "The AI didn't return usable routines.");
  return out.slice(0, 5);
}

/* ---------------- Short plain-English notes ---------------- */
const NOTE_SYSTEM = `You write ONE short, friendly sentence (at most 28 words) for a gym coaching app, in plain English, using ONLY the facts you are given. Never invent numbers, never mention names, never give medical advice or diagnose anything. If the facts are thin, say something encouraging and generic. Return just the sentence, no quotes.`;

/** One short sentence explaining a suggestion or summarising a client, from a compact fact sheet. Never throws on a busy AI: returns null. */
export async function aiShortNote(kind: "why" | "eye", facts: string): Promise<string | null> {
  try {
    const content = await groq(
      {
        model: TEXT_MODEL,
        temperature: 0.3,
        reasoning_effort: "low",
        max_completion_tokens: 400,
        messages: [
          { role: "system", content: NOTE_SYSTEM },
          { role: "user", content: `${kind === "why" ? "Explain why this training target is suggested today, to the person training." : "Give the coach a one-line heads-up about this client before the session."}
FACTS: ${facts.slice(0, 1200)}` },
        ],
      },
      20_000,
    );
    const text = content.replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim();
    return text.length >= 8 ? text.slice(0, 240) : null;
  } catch {
    return null;
  }
}

/* ---------------- Client details (import) and assessment summaries ---------------- */
const CLIENT_SYSTEM = `You read a personal trainer's raw notes about one or more new or existing clients (typed, pasted from WhatsApp or a form, copied from a spreadsheet, or transcribed from a photo) and return them as JSON.

Return ONLY one JSON object, no commentary, with this shape:
{"clients":[{
  "name": string,                 // the person's full name as written
  "phone": string | null,         // as written
  "email": string | null,
  "dob": "YYYY-MM-DD" | null,     // ONLY if a birth date is written; read day-first (12/03/1990 = 12 March 1990)
  "goal": "Hypertrophy" | "Fat Loss" | "Strength" | "Conditioning" | "General Fitness" | null,
  "level": "Beginner" | "Intermediate" | "Advanced" | null,   // training experience, only if written or clearly implied
  "medicalNotes": string | null,  // injuries, conditions, medication, anything about health, kept short and faithful
  "credits": integer | null,      // sessions in a package, only if a number of sessions is written
  "packageSize": integer | null,
  "homeAddress": string | null
}]}

Rules:
- One object per person. Several people are separated by blank lines, numbering, bullets or table rows.
- Never invent anything. If a field is not written, use null. Do not guess a goal or level from nothing.
- Phone numbers and emails keep the form they were written in. Fix obvious spacing only.
- "goal": map "lose weight", "tone up", "cut" to Fat Loss; "build muscle", "bulk", "size" to Hypertrophy; "get stronger", "powerlifting" to Strength; "cardio", "endurance", "stamina", "sport" to Conditioning; "general fitness", "health" to General Fitness.
- Ignore greetings and chatter that is not about a client.`;

export async function aiReadClients(text: string): Promise<unknown[]> {
  const content = await groq(
    {
      model: TEXT_MODEL,
      temperature: 0,
      reasoning_effort: "low",
      max_completion_tokens: 6000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLIENT_SYSTEM },
        { role: "user", content: `NOTES:\n"""\n${text.slice(0, 16000)}\n"""` },
      ],
    },
    45_000,
  );
  let parsed: unknown;
  try {
    parsed = jsonFrom(content);
  } catch {
    throw new HttpError(502, "The AI answer couldn't be read.");
  }
  const list = (parsed as { clients?: unknown }).clients;
  return Array.isArray(list) ? list.slice(0, 50) : [];
}

/** A short plain-English paragraph for the coach from assessment findings (no names are ever sent). */
export async function aiAssessmentNote(facts: string): Promise<string | null> {
  try {
    const content = await groq(
      {
        model: TEXT_MODEL,
        temperature: 0.3,
        reasoning_effort: "low",
        max_completion_tokens: 500,
        messages: [
          { role: "system", content: "You help a personal trainer. From posture and movement findings, write 2 to 3 plain sentences saying what to work on besides building muscle (mobility, activation, stability, technique) and what to be careful about. No diagnosis, no medical claims, no names. If a finding suggests a doctor's check, say so gently." },
          { role: "user", content: `FINDINGS: ${facts.slice(0, 1200)}` },
        ],
      },
      20_000,
    );
    const text = content.replace(/\s+/g, " ").trim();
    return text.length >= 20 ? text.slice(0, 700) : null;
  } catch {
    return null;
  }
}
