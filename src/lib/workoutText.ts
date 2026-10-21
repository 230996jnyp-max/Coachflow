/*
 * Free-text workout parser: turns a coach's Notepad / WhatsApp / Notes plan into structured workouts.
 * Pure functions with no app imports, so it can be tested on its own.
 *
 * Understands lines such as
 *   Barbell Bench Press - 4 x 8 @ 80kg        Incline Dumbbell Press: 3 sets x 10-12 reps (24kg)
 *   Lat Pulldown 3x12                          Treadmill Incline Walk - 20 mins
 *   Squat 60x10, 70x8, 80x6                    Plank 3 x 45s            Bench Press 100kg x 5 x 3
 * with "# Push Day A" style headings, bullets / numbering, notes lines and (optionally) a date such as
 * "12 Oct 2026", "12/10/2026" or "2026-10-12" on a heading or on a line of its own.
 */

export type ParsedUnit = "metric" | "imperial";

export interface ParsedSet {
  reps?: number;
  /** Always kilograms. */
  weightKg?: number;
  durationSec?: number;
  distanceKm?: number;
  rpe?: number;
}

export interface ParsedExercise {
  /** The name exactly as written (cleaned of bullets and numbering). */
  raw: string;
  sets: ParsedSet[];
  repMin?: number;
  repMax?: number;
  notes: string;
  /** True for time / distance based lines (cardio, planks…). */
  timed: boolean;
  /** The line had no sets/reps/time, so defaults were filled in. */
  noSets: boolean;
}

export interface ParsedWorkout {
  title: string;
  /** yyyy-MM-dd, only when the text actually contained a date. */
  date?: string;
  notes: string;
  exercises: ParsedExercise[];
}

export interface ParseOptions {
  /** How to read a weight written without kg / lb. */
  unit: ParsedUnit;
  today: Date;
  /** Lets a bare line like "Squat" be recognised as an exercise rather than a heading. */
  isKnown?: (name: string) => boolean;
}

const KG_PER_LB = 0.45359237;
const MI_TO_KM = 1.609344;

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY_RE = /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b\.?,?/gi;

const pad = (n: number) => String(n).padStart(2, "0");

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** A date with no year means "the most recent such date" (not more than two weeks in the future). */
function inferYear(m: number, d: number, today: Date): number {
  let y = today.getFullYear();
  const cand = new Date(y, m - 1, d).getTime();
  if (cand - today.getTime() > 14 * 86400000) y -= 1;
  return y;
}

export function extractDate(text: string, today: Date): { date: string; rest: string } | null {
  const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
  const finish = (match: RegExpMatchArray, date: string) => {
    let rest = text.replace(match[0], " ").replace(WEEKDAY_RE, " ").replace(/\bdate\s*:?/gi, " ");
    rest = rest.replace(/\s{2,}/g, " ");
    return { date, rest };
  };

  let m: RegExpMatchArray | null;

  // 2026-10-12, 2026/10/12
  if ((m = text.match(/(?<![\d.])(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d])/))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (isRealDate(y, mo, d)) return finish(m, fmt(y, mo, d));
  }
  // 12/10/2026, 12-10-26, 12.10.2026 (day first, as written in Singapore)
  if ((m = text.match(/(?<![\d.])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d])/))) {
    let [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (isRealDate(y, mo, d)) return finish(m, fmt(y, mo, d));
  }
  // 12 Oct 2026, 12th October, 12-Oct
  if ((m = text.match(new RegExp(`(?<![\\d.])(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*${MONTH_RE}\\b\\.?(?:,?\\s*(\\d{4}))?`, "i")))) {
    const d = Number(m[1]);
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const y = m[3] ? Number(m[3]) : inferYear(mo, d, today);
    if (isRealDate(y, mo, d)) return finish(m, fmt(y, mo, d));
  }
  // Oct 12, October 12th, 2026
  if ((m = text.match(new RegExp(`\\b${MONTH_RE}\\b\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`, "i")))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const d = Number(m[2]);
    const y = m[3] ? Number(m[3]) : inferYear(mo, d, today);
    if (isRealDate(y, mo, d)) return finish(m, fmt(y, mo, d));
  }
  // 12/10 (no year)
  if ((m = text.match(/(?<![\d./])(\d{1,2})\/(\d{1,2})(?![\d/])/))) {
    let [d, mo] = [Number(m[1]), Number(m[2])];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    const y = inferYear(mo, d, today);
    if (isRealDate(y, mo, d)) return finish(m, fmt(y, mo, d));
  }
  if ((m = text.match(/\b(today|yesterday)\b/i))) {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (m[1].toLowerCase() === "yesterday" ? 1 : 0));
    return finish(m, fmt(t.getFullYear(), t.getMonth() + 1, t.getDate()));
  }
  return null;
}

/* ---------------- Line helpers ---------------- */
function cleanLine(raw: string): string {
  let l = raw
    .replace(/[   ]/g, " ")
    .replace(/[×✕✖]/g, "x")
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/[*`]/g, "")
    .trim();
  l = l.replace(/^[\s>•·▪◦‣⁃●○■□☐☑✓✔➤▶►*-]+(?=\S)/u, "");
  l = l.replace(/^\d{1,2}[.)]\s+(?=\D)/, "");
  l = l.replace(/^[A-Da-d]\d?[.)]\s+(?=\S)/, "");
  return l.replace(/\s{2,}/g, " ").trim();
}

const SPEC_START =
  /(?<![\w.])(?:\d+(?:\.\d+)?\s*(?:x\b|x(?=\d)|sets?\b|reps?\b|kgs?\b|lbs?\b|mins?\b|minutes?\b|hrs?\b|hours?\b|secs?\b|seconds?\b|km\b|miles?\b|mi\b|m\b|s\b|h\b)|x\s*\d|\d+:\d{2}\b|amrap\b|to failure\b|for time\b)/i;

const trimName = (s: string) => s.replace(/[\s\-:|,@(\[]+$/g, "").replace(/^[\s\-:|,]+/, "").trim();

interface Spec {
  sets: ParsedSet[];
  repMin?: number;
  repMax?: number;
  timed: boolean;
  notes: string[];
  found: boolean;
}

function parseSpec(spec: string, unit: ParsedUnit): Spec {
  let t = ` ${spec} `;
  const notes: string[] = [];
  const weightOf = (v: number, u?: string) => {
    const lb = u ? /^lb/i.test(u) : unit === "imperial";
    return Math.round((lb ? v * KG_PER_LB : v) * 100) / 100;
  };
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = t.match(re);
    if (m) t = t.replace(m[0], " ");
    return m;
  };

  let rpe: number | undefined;
  let m: RegExpMatchArray | null;

  if ((m = take(/\brest(?:ing)?\s*(?:of|:)?\s*(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m)?\b/i))) {
    const n = Number(m[1]);
    const u = (m[2] ?? "").toLowerCase();
    const mins = u.startsWith("m") ? true : u ? false : n <= 5;
    notes.push(`Rest ${n}${mins ? " min" : "s"}`);
  }
  if ((m = take(/\btempo\s*:?\s*([\dxX]+(?:-[\dxX]+){1,3})/i))) notes.push(`Tempo ${m[1]}`);
  if ((m = take(/\brir\s*[:@]?\s*(\d+)/i))) notes.push(`${m[1]} reps in reserve`);
  if ((m = take(/@?\s*\brpe\s*[:@]?\s*(\d+(?:\.\d+)?)/i))) rpe = Number(m[1]);

  let sets: ParsedSet[] = [];
  let setCount: number | undefined;
  let repMin: number | undefined;
  let repMax: number | undefined;
  let weight: number | undefined;
  let duration: number | undefined;
  let distance: number | undefined;
  let timed = false;
  let found = false;
  let perSet = false;

  if (/\bamrap\b/i.test(t)) {
    const am = take(/(\d+)\s*(?:sets?\s*)?x\s*amrap\b/i);
    if (am) setCount = Number(am[1]);
    else take(/\bamrap\b/i);
    notes.push("AMRAP");
    found = true;
  }
  if (/\bto failure\b|\bfailure\b/i.test(t)) {
    take(/\b(?:to )?failure\b/i);
    notes.push("To failure");
    found = true;
  }

  // 1) per-set lists: "60x10, 70x8, 80x6" / "10 @ 60kg, 8 @ 70kg"
  const parts = t
    .split(/\s*[,;]\s*|\s+then\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const A = /^(\d+(?:\.\d+)?)\s*(kgs?|lbs?)?\s*x\s*(\d+)\s*(?:reps?)?$/i;
    const B = /^(\d+)\s*(?:reps?)?\s*@\s*(\d+(?:\.\d+)?)\s*(kgs?|lbs?)?$/i;
    const matched = parts.map((p) => p.match(A) ?? p.match(B));
    if (matched.every(Boolean)) {
      const anyUnit = parts.some((p) => /kgs?|lbs?/i.test(p));
      const asWeights = anyUnit || matched.some((mm, i) => (parts[i].match(A) ? Number(mm![1]) >= 20 : true));
      matched.forEach((mm, i) => {
        if (parts[i].match(A)) {
          if (asWeights) sets.push({ weightKg: weightOf(Number(mm![1]), mm![2]), reps: Number(mm![3]) });
          else for (let k = 0; k < Number(mm![1]); k++) sets.push({ reps: Number(mm![3]) });
        } else {
          sets.push({ reps: Number(mm![1]), weightKg: weightOf(Number(mm![2]), mm![3]) });
        }
      });
      perSet = true;
      found = true;
      t = " ";
    }
  }

  if (!perSet) {
    // 2) weight x reps [x sets]: "100kg x 5 x 3", "80 kg x 8"
    if ((m = take(/(\d+(?:\.\d+)?)\s*(kgs?|lbs?)\s*x\s*(\d+)(?:\s*x\s*(\d+))?/i))) {
      weight = weightOf(Number(m[1]), m[2]);
      repMin = repMax = Number(m[3]);
      setCount = m[4] ? Number(m[4]) : 1;
      found = true;
    }
    // 3) sets x reps: "4 x 8", "3 sets x 10-12 reps", "3 sets of 10", "3x45s"
    else if ((m = take(/(\d+)\s*(?:sets?\s*)?(?:x|of)\s*(\d+)(?:\s*-\s*(\d+)|\s*to\s*(\d+))?\s*(seconds?|secs?|s|minutes?|mins?|reps?)?(?![a-z])/i))) {
      setCount = Number(m[1]);
      const lo = Number(m[2]);
      const hi = m[3] || m[4] ? Number(m[3] ?? m[4]) : lo;
      const u = (m[5] ?? "").toLowerCase();
      if (u && !u.startsWith("rep")) {
        timed = true;
        const k = u.startsWith("m") ? 60 : 1;
        duration = hi * k;
      } else {
        repMin = Math.min(lo, hi);
        repMax = Math.max(lo, hi);
      }
      found = true;
    } else {
      // "x 8" on its own, "8 reps", "3 sets"
      if ((m = take(/(?<![\w])x\s*(\d+)(?:\s*-\s*(\d+))?(?![\w:])/i))) {
        repMin = Number(m[1]);
        repMax = m[2] ? Number(m[2]) : repMin;
        if (repMin > repMax) [repMin, repMax] = [repMax, repMin];
        found = true;
      }
      if ((m = take(/(\d+)\s*sets?\b/i))) {
        setCount = Number(m[1]);
        found = true;
      }
      if ((m = take(/(\d+)(?:\s*-\s*(\d+))?\s*reps?\b/i))) {
        repMin = Number(m[1]);
        repMax = m[2] ? Number(m[2]) : repMin;
        if (repMin > repMax) [repMin, repMax] = [repMax, repMin];
        found = true;
      }
    }

    // 4) time and distance
    const times = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|seconds?|secs?|s|m)\b(?!\w)/gi)];
    for (const tm of times) {
      const n = Number(tm[1]);
      const u = tm[2].toLowerCase();
      if (u === "m" && n >= 60) {
        distance = (distance ?? 0) + n / 1000;
      } else {
        const k = u.startsWith("h") ? 3600 : u.startsWith("m") ? 60 : 1;
        duration = (duration ?? 0) + Math.round(n * k);
      }
      t = t.replace(tm[0], " ");
      found = true;
      timed = true;
    }
    if ((m = take(/\b(\d+):(\d{2})\b/))) {
      duration = (duration ?? 0) + Number(m[1]) * 60 + Number(m[2]);
      found = true;
      timed = true;
    }
    for (const dm of [...t.matchAll(/(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?|miles?|mi)\b/gi)]) {
      const n = Number(dm[1]);
      distance = (distance ?? 0) + (/^mi/i.test(dm[2]) ? n * MI_TO_KM : n);
      t = t.replace(dm[0], " ");
      found = true;
      timed = true;
    }

    // 5) loose weights: "@ 80kg", "(24kg)", "+10kg", "@ 80"
    if (weight === undefined && (m = take(/[+@(]?\s*(\d+(?:\.\d+)?)\s*(kgs?|lbs?)\b\)?/i))) {
      weight = weightOf(Number(m[1]), m[2]);
      found = true;
    }
    if ((m = take(/@\s*(\d+(?:\.\d+)?)(?![\w.])/))) {
      const n = Number(m[1]);
      if (weight === undefined && n > 10) {
        weight = weightOf(n);
        found = true;
      } else if (rpe === undefined && n <= 10) {
        rpe = n;
      }
    }

    // 6) assemble
    if (found) {
      const count = setCount ?? 1;
      for (let i = 0; i < count; i++) {
        const s: ParsedSet = {};
        if (repMax !== undefined) s.reps = repMax;
        if (weight !== undefined) s.weightKg = weight;
        if (duration !== undefined) s.durationSec = Math.round(duration);
        if (distance !== undefined) s.distanceKm = Math.round(distance * 1000) / 1000;
        sets.push(s);
      }
    }
  }

  if (rpe !== undefined) for (const s of sets) s.rpe = rpe;

  // Whatever is left (e.g. "each side", "slow negatives") becomes a note.
  const leftover = t
    .replace(/\b(reps?|sets?|of|with|at|for|in|x)\b/gi, " ")
    .replace(/(^|\s)\/\s*(?=\w)/g, "$1per ")
    .replace(/[()@,;:+\-[\]]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (leftover && /[a-z]/i.test(leftover)) notes.push(leftover);

  if (perSet) {
    const reps = sets.map((s) => s.reps).filter((n): n is number => n !== undefined);
    if (reps.length) {
      repMin = Math.min(...reps);
      repMax = Math.max(...reps);
    }
  }
  sets = sets.slice(0, 60);
  return { sets, repMin, repMax, timed: timed || sets.some((s) => s.durationSec || s.distanceKm), notes, found };
}

/* ---------------- Whole-text parser ---------------- */
const BLANK_EXERCISE = (name: string): ParsedExercise => ({
  raw: name,
  sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }],
  repMin: 8,
  repMax: 12,
  notes: "",
  timed: false,
  noSets: true,
});

const NOTE_LINE = /^(?:notes?|tips?|cues?|remarks?|comments?)\s*[:-]\s*(.*)$/i;
const META_LINE = /^(?:(?:client|location|gym|duration|volume|summary|exported|generated|total|coach|trainer)\s*:|\d+ exercises?\b.*\bsets?\b)/i;
const HEADING_WORD = /^(?:day|week|workout|session|routine|program(?:me)?|phase|block)\b/i;

export function parseWorkoutText(text: string, opts: ParseOptions): ParsedWorkout[] {
  const out: ParsedWorkout[] = [];
  const st: { cur: ParsedWorkout | null; last: ParsedExercise | null } = { cur: null, last: null };
  let prevBlank = true;

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = (title: string, date?: string): ParsedWorkout => {
    const w: ParsedWorkout = { title, date, notes: "", exercises: [] };
    st.cur = w;
    st.last = null;
    out.push(w);
    return w;
  };

  const nextLine = (i: number): string => {
    for (let j = i + 1; j < lines.length; j++) {
      const c = cleanLine(lines[j]);
      if (c) return c;
    }
    return "";
  };
  const hasSpec = (line: string) => {
    const idx = line.search(SPEC_START);
    return idx >= 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim()) {
      prevBlank = true;
      continue;
    }
    const wasBlockStart: boolean = prevBlank;
    prevBlank = false;

    // Comment lines and export metadata (written by CoachFlow's own text export) carry no workout data.
    if (/^\s*\/\//.test(rawLine) || META_LINE.test(cleanLine(rawLine))) {
      prevBlank = wasBlockStart;
      continue;
    }

    const isMdHeading = /^\s*#{1,6}\s*\S/.test(rawLine);
    const line = cleanLine(rawLine.replace(/^\s*#{1,6}\s*/, ""));
    if (!line) continue;

    // Notes belong to the exercise above (or to the workout when there is none yet).
    const nm = line.match(NOTE_LINE);
    if (nm) {
      if (st.last) st.last.notes = [st.last.notes, nm[1]].filter(Boolean).join("; ");
      else if (st.cur) st.cur.notes = [st.cur.notes, nm[1]].filter(Boolean).join("; ");
      continue;
    }

    // Date-only line ("Date: 12 Oct 2026", "Mon 12/10").
    const dt = !isMdHeading ? extractDate(line, opts.today) : null;
    if (dt && !/[a-z]{3,}/i.test(dt.rest.replace(/\bdate\b/gi, "").replace(/[^a-z]/gi, " "))) {
      const c = st.cur;
      if (c && c.exercises.length === 0 && !c.date) c.date = dt.date;
      else start("", dt.date);
      continue;
    }

    const specIdx = line.search(SPEC_START);
    const looksHeading = isMdHeading || /:\s*$/.test(line) || HEADING_WORD.test(line);

    // A line like "Squat" (no numbers) is a heading only at the start of a block and when it is not a known exercise.
    const bareName = specIdx < 0 ? trimName(line) : "";
    const known = !!bareName && !!opts.isKnown?.(bareName);

    if (specIdx < 0 && !known && (looksHeading || (wasBlockStart && (hasSpec(nextLine(i)) || !st.cur || st.cur.exercises.length > 0)))) {
      // Heading: may carry a date ("Push Day - 12 Oct 2026").
      let title = line.replace(/:\s*$/, "");
      const d = extractDate(title, opts.today);
      if (d) title = d.rest;
      title = title.replace(/^[\s\-:|,()[\]]+|[\s\-:|,()[\]]+$/g, "").replace(/\s{2,}/g, " ");
      const c = st.cur;
      if (c && c.exercises.length === 0) {
        if (!c.title) c.title = title;
        else if (title) c.notes = [c.notes, title].filter(Boolean).join("; ");
        if (d && !c.date) c.date = d.date;
      } else {
        start(title, d?.date);
      }
      continue;
    }

    // Exercise line.
    const c = st.cur ?? start("");
    if (specIdx < 0) {
      // Bare exercise name with no numbers.
      const ex = BLANK_EXERCISE(bareName || line);
      c.exercises.push(ex);
      st.last = ex;
      continue;
    }
    const name = trimName(line.slice(0, specIdx));
    const spec = parseSpec(line.slice(specIdx), opts.unit);
    if (!name) {
      // "60kg x 8" under an exercise name written on the line above.
      const l = st.last;
      if (l && spec.found) {
        if (l.noSets) {
          l.sets = [];
          l.noSets = false;
          l.repMin = undefined;
          l.repMax = undefined;
        }
        l.sets.push(...spec.sets);
        l.timed = l.timed || spec.timed;
        const reps = l.sets.map((s) => s.reps).filter((n): n is number => n !== undefined);
        if (reps.length) {
          l.repMin = Math.min(...reps);
          l.repMax = Math.max(...reps);
        }
        if (spec.notes.length) l.notes = [l.notes, ...spec.notes].filter(Boolean).join("; ");
      }
      continue;
    }
    const ex: ParsedExercise = spec.found
      ? { raw: name, sets: spec.sets, repMin: spec.repMin, repMax: spec.repMax, notes: spec.notes.join("; "), timed: spec.timed, noSets: false }
      : { ...BLANK_EXERCISE(name), notes: spec.notes.join("; ") };
    c.exercises.push(ex);
    st.last = ex;
  }

  return out.filter((w) => w.exercises.length > 0);
}
