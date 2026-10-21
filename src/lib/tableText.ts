/*
 * Spreadsheet / table rows → the same "Exercise - 4 x 8 @ 80kg" lines the free-text parser understands.
 * Used for Excel, CSV, Word tables, Markdown tables and the tables inside CoachFlow's own PDF exports.
 * Pure functions (no imports) so they can be tested on their own.
 */

/** A row of cells; PDF rows also carry each cell's x position so wrapped notes can be re-attached. */
export type Row = string[] & { xs?: number[] };

interface Cols {
  name: number;
  sets?: number;
  reps?: number;
  weight?: number;
  time?: number;
  dist?: number;
  notes?: number;
  unit: string;
  /** Horizontal position of the notes column (PDF only). */
  noteX?: number;
}

const H = {
  name: /^(exercises?|movements?|lifts?|name|workout|exercise name)$/i,
  sets: /^(sets?|no\.? of sets|# ?sets)$/i,
  reps: /^(reps?|repetitions?|rep range|reps?\/time)$/i,
  weight: /^(weight|load|kgs?|lbs?|weights?)(\s*\(.*\))?$/i,
  time: /^(time|duration|mins?|minutes?)(\s*\(.*\))?$/i,
  dist: /^(distance|km)(\s*\(.*\))?$/i,
  notes: /^(notes?|comments?|remarks?|tempo|rest|cues?)$/i,
};

/** "80kg", "80 kg", "225 lbs" — the unit may sit right against the number. */
const UNIT_RE = /(?<=\d|\s|^|\()(kgs?|lbs?)\b/i;
const UNIT_RE_G = /(?<=\d|\s|^|\()(kgs?|lbs?)\b/gi;

const dashy = (s: string) => (/^[-–—\s]*$/.test(s) ? "" : s.trim());

function detectHeader(cells: string[]): Cols | null {
  const idx = (re: RegExp) => {
    const i = cells.findIndex((c) => re.test(c.trim()));
    return i >= 0 ? i : undefined;
  };
  const name = idx(H.name);
  if (name === undefined) return null;
  const cols: Cols = { name, sets: idx(H.sets), reps: idx(H.reps), weight: idx(H.weight), time: idx(H.time), dist: idx(H.dist), notes: idx(H.notes), unit: "" };
  if ([cols.sets, cols.reps, cols.weight, cols.time, cols.dist].every((v) => v === undefined)) return null;
  if (cols.weight !== undefined) cols.unit = cells[cols.weight].match(UNIT_RE)?.[1].toLowerCase().replace(/s$/, "") ?? "";
  return cols;
}

const num = (s: string) => s.match(/\d+(?:\.\d+)?/)?.[0];

function compose(name: string, c: { sets: string; reps: string; weight: string; time: string; dist: string; notes: string; unit: string }): string[] {
  const out: string[] = [];
  const sets = c.sets.match(/^\d+/)?.[0];
  const reps = c.reps.replace(/\s*\|\s*/g, " ").trim();
  const unitIn = c.weight.match(UNIT_RE)?.[1].toLowerCase().replace(/s$/, "") ?? c.unit;
  const wParts = c.weight
    .replace(UNIT_RE_G, "")
    .split(/\s*[/,]\s*/)
    .map((p) => num(p))
    .filter((p): p is string => !!p);
  const withUnit = (w: string) => `${w}${unitIn}`;

  let spec = "";
  const rParts = reps.split(/\s*\/\s*/).filter(Boolean);
  const timedReps = /\b(sec|secs|seconds?|mins?|minutes?|km|m)\b/i.test(reps);

  if (timedReps || c.time || c.dist) {
    const each = reps.match(/^(\d+(?:\.\d+)?)\s*(sec|secs|seconds?|s)\b(?:\s*each)?$/i);
    if (each && sets && Number(sets) > 1) spec = `${sets} x ${each[1]}s`;
    else spec = [reps, c.time, c.dist ? `${num(c.dist)}km` : ""].filter(Boolean).join(" ").trim();
  } else if (rParts.length > 1 && rParts.every((r) => /^\d+$/.test(r))) {
    if (wParts.length === rParts.length) spec = rParts.map((r, i) => `${withUnit(wParts[i])} x ${r}`).join(", ");
    else {
      const lo = Math.min(...rParts.map(Number));
      const hi = Math.max(...rParts.map(Number));
      spec = `${rParts.length} x ${lo === hi ? lo : `${lo}-${hi}`}${wParts.length ? ` @ ${withUnit(wParts[wParts.length - 1])}` : ""}`;
    }
  } else if (reps || sets) {
    spec = reps ? `${sets ? `${sets} x ` : ""}${reps}` : `${sets} sets`;
    if (wParts.length) spec += ` @ ${withUnit(wParts[wParts.length - 1])}`;
  } else if (wParts.length) spec = withUnit(wParts[0]);

  out.push(spec ? `${name} - ${spec}` : name);
  const note = c.notes.replace(/\bPR\b/g, "").replace(/\s+/g, " ").trim();
  if (note) out.push(`  Note: ${note}`);
  return out;
}

/** Converts rows of cells into text lines; non-table rows pass through unchanged. */
export function rowsToLines(rows: Row[]): string[] {
  const out: string[] = [];
  let cols: Cols | null = null;
  let lastNote = -1;
  let inTable = false;
  for (const raw of rows) {
    const cells = raw.map((c) => (c ?? "").replace(/\s+/g, " ").trim());
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    if (cells.length === 0) {
      out.push("");
      continue;
    }

    if (cells.length >= 2) {
      const head = detectHeader(cells);
      if (head) {
        cols = head;
        head.noteX = head.notes !== undefined ? raw.xs?.[head.notes] : undefined;
        inTable = false;
        continue;
      }
    }

    // A note that wrapped onto a second line sits alone under the notes column: glue it to the row above.
    if (cols && inTable && cells.length === 1 && cols.noteX !== undefined && raw.xs?.[0] !== undefined && raw.xs[0] >= cols.noteX - 3) {
      if (lastNote >= 0) out[lastNote] += ` ${cells[0]}`;
      else {
        out.push(`  Note: ${cells[0]}`);
        lastNote = out.length - 1;
      }
      continue;
    }

    if (cols && cells.length >= 2 && cells[cols.name]) {
      const g = (i?: number) => (i === undefined ? "" : dashy(cells[i] ?? ""));
      const lines = compose(cells[cols.name], { sets: g(cols.sets), reps: g(cols.reps), weight: g(cols.weight), time: g(cols.time), dist: g(cols.dist), notes: g(cols.notes), unit: cols.unit });
      out.push(...lines);
      lastNote = lines.length > 1 ? out.length - 1 : -1;
      inTable = true;
      continue;
    }
    inTable = false;

    // No header: "Bench Press | 4 | 8 | 80kg"
    if (cells.length >= 3 && !/^\d/.test(cells[0]) && /^\d{1,2}$/.test(cells[1]) && /^\d+(?:\s*-\s*\d+)?$/.test(cells[2])) {
      out.push(...compose(cells[0], { sets: cells[1], reps: cells[2], weight: dashy(cells[3] ?? ""), time: "", dist: "", notes: dashy(cells[4] ?? ""), unit: "" }));
      continue;
    }

    out.push(cells.filter(Boolean).join(cells.length > 1 ? "   " : ""));
  }
  return out;
}
