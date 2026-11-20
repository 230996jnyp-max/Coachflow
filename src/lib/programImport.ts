import { isKnownName, matchExercise, type MatchIndex } from "./exerciseMatch";
import { MAX_DAYS, MAX_PER_DAY, MAX_WEEKS, cleanExercise, sortSlots, type ProgramSlot } from "./programs";
import type { TemplateExercise } from "./types";
import { parseWorkoutText } from "./workoutText";

/*
 * Reads a whole program written as text (pasted, or taken from a PDF or photo by the existing file reader):
 *
 *   Week 1
 *   Day 1 Upper body
 *   Bench press 4x8 60kg
 *   ...
 *   Day 2 ...
 *   Weeks 2-4: same as week 1, +2.5kg        (a range repeats the block for each of those weeks)
 *
 * Each day's lines go through the same reader as workout imports and each exercise is matched to the library. Names that match nothing are
 * handed back so the coach can create them as custom exercises, then the text is read again.
 */

export interface UnmatchedExercise {
  name: string;
  timed: boolean;
  hasWeight: boolean;
  hasDistance: boolean;
}

export interface ProgramImport {
  slots: ProgramSlot[];
  weeks: number;
  unmatched: UnmatchedExercise[];
  notes: string[];
}

const WEEKDAYS: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
const WEEK_RE = /^\s*(?:#+\s*)?weeks?\s*(\d{1,2})(?:\s*(?:-|–|—|to)\s*(\d{1,2}))?\s*[:.\-–—]?\s*(.*)$/i;
const DAY_RE = /^\s*(?:#+\s*)?day\s*(\d{1,2})\s*[:.\-–—]?\s*(.*)$/i;
const WEEKDAY_RE = /^\s*(?:#+\s*)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b\s*[:.\-–—]?\s*(.*)$/i;

interface Block {
  weeks: number[];
  day: number;
  title: string;
  lines: string[];
}

let n = 0;
const id = () => `ps_imp${Date.now().toString(36)}${(n++).toString(36)}`;

export function parseProgramText(text: string, index: MatchIndex, today = new Date()): ProgramImport {
  const notes: string[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let weeks: number[] = [1];
  let cur: Block | null = null;
  let sawDay = false;
  let weekdayNames = false;
  let loose = 1;

  const flush = () => {
    if (cur && cur.lines.some((l) => l.trim())) blocks.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const wk = WEEK_RE.exec(line);
    if (wk && !/^weeks?\s*\d+\s*(?:sets?|reps?)\b/i.test(line)) {
      flush();
      const a = Math.min(MAX_WEEKS, Math.max(1, Number(wk[1])));
      const b = wk[2] ? Math.min(MAX_WEEKS, Math.max(a, Number(wk[2]))) : a;
      weeks = Array.from({ length: b - a + 1 }, (_, i) => a + i);
      loose = 1;
      if (wk[3] && !/^same as/i.test(wk[3])) notes.push(`Week heading note ignored: "${wk[3].slice(0, 40)}".`);
      continue;
    }
    const dy = DAY_RE.exec(line);
    const wd = !dy ? WEEKDAY_RE.exec(line) : null;
    if (dy || wd) {
      flush();
      sawDay = true;
      if (wd) weekdayNames = true;
      const day = dy ? Math.min(MAX_DAYS, Math.max(1, Number(dy[1]))) : WEEKDAYS[wd![1].toLowerCase()];
      cur = { weeks, day, title: ((dy ? dy[2] : wd![2]) ?? "").trim(), lines: [] };
      continue;
    }
    if (!line) {
      // A blank line ends a loose block (text with no "Day" headings): each paragraph becomes the next day.
      if (cur && !sawDay && cur.lines.some((l) => l.trim())) flush();
      continue;
    }
    if (!cur) cur = { weeks, day: sawDay ? 1 : loose++, title: "", lines: [] };
    cur.lines.push(line);
  }
  flush();
  if (weekdayNames) notes.push("Days were written as weekdays, so Monday is day 1. Start the program on a Monday to keep them lined up.");
  if (!sawDay && blocks.length) notes.push("There were no day headings, so each paragraph was read as one day.");

  const unmatched = new Map<string, UnmatchedExercise>();
  const slots: ProgramSlot[] = [];
  const perDay = new Map<string, number>();
  let dropped = 0;
  const parseOpts = { unit: "metric" as const, today, isKnown: (name: string) => isKnownName(name, index) };

  for (const b of blocks) {
    const parsed = parseWorkoutText(b.lines.join("\n"), parseOpts);
    const exercises: TemplateExercise[] = [];
    let title = b.title;
    for (const w of parsed) {
      if (!title && w.title) title = w.title;
      for (const p of w.exercises) {
        const m = matchExercise(p.raw, index);
        if (!m.best) {
          unmatched.set(p.raw.toLowerCase(), { name: p.raw, timed: p.timed, hasWeight: p.sets.some((s) => s.weightKg), hasDistance: p.sets.some((s) => s.distanceKm) });
          continue;
        }
        const first = p.sets[0] ?? {};
        const reps = p.repMin ?? first.reps ?? 10;
        const ex = cleanExercise({
          exerciseId: m.best.id,
          sets: Math.max(1, p.sets.length),
          repMin: p.timed ? 0 : reps,
          repMax: p.timed ? 0 : (p.repMax ?? reps),
          weight: first.weightKg,
          durationSec: p.timed ? (first.durationSec ?? 60) : undefined,
          distanceKm: first.distanceKm,
          notes: p.notes,
        });
        if (ex) exercises.push(ex);
      }
    }
    if (exercises.length === 0) continue;
    for (const week of b.weeks) {
      const key = `${week}:${b.day}`;
      const count = (perDay.get(key) ?? 0) + 1;
      if (count > MAX_PER_DAY) {
        dropped++;
        continue;
      }
      perDay.set(key, count);
      slots.push({ id: id(), week, day: b.day, title: (title || `Week ${week} · Day ${b.day}`).slice(0, 120), exercises: exercises.map((e) => ({ ...e })) });
    }
  }
  if (dropped) notes.push(`${dropped} workout${dropped === 1 ? "" : "s"} did not fit (at most ${MAX_PER_DAY} a day) and ${dropped === 1 ? "was" : "were"} left out.`);
  const maxWeek = slots.reduce((m, s) => Math.max(m, s.week), 0);
  return { slots: sortSlots(slots), weeks: Math.max(1, maxWeek), unmatched: [...unmatched.values()], notes };
}
