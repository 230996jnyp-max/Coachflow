/*
 * Importing client details. Turns a pasted list, a spreadsheet's rows or a client's details written as "Label: value" lines into
 * clean candidate records. The AI reader (server side) produces the same shape, and every candidate, whoever made it, goes through
 * cleanCandidate before anything is shown or saved. Pure: no imports, so it runs in the browser and on the server.
 */

export const GOAL_VALUES = ["Hypertrophy", "Fat Loss", "Strength", "Conditioning", "General Fitness"] as const;
export type GoalValue = (typeof GOAL_VALUES)[number];
export const LEVEL_VALUES = ["Beginner", "Intermediate", "Advanced"] as const;
export type LevelValue = (typeof LEVEL_VALUES)[number];

export interface ClientCandidate {
  name: string;
  phone?: string;
  email?: string;
  /** yyyy-MM-dd */
  dob?: string;
  goal?: GoalValue;
  level?: LevelValue;
  /** Injuries, conditions, anything about health. */
  medicalNotes?: string;
  credits?: number;
  packageSize?: number;
  homeAddress?: string;
}

export const CANDIDATE_FIELDS: { key: keyof ClientCandidate; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "dob", label: "Date of birth" },
  { key: "goal", label: "Goal" },
  { key: "level", label: "Experience" },
  { key: "medicalNotes", label: "Injuries and health notes" },
  { key: "credits", label: "Session credits" },
  { key: "packageSize", label: "Package size" },
  { key: "homeAddress", label: "Home address" },
];

const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "");

/** The last digits of a phone number, for matching ("+65 9123 4567" and "91234567" are the same person). */
export const phoneKey = (p: string | undefined | null): string => (p ?? "").replace(/\D/g, "").slice(-8);
export const emailKey = (e: string | undefined | null): string => (e ?? "").trim().toLowerCase();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Reads a date written many ways (2026-03-14, 14/03/1990, 14 Mar 1990, March 14, 1990). Day first for numbers with slashes. */
export function parseLooseDate(v: string): string | undefined {
  const s = v.trim();
  if (!s) return undefined;
  let y = 0, m = 0, d = 0;
  let x = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (x) [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  else if ((x = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
    d = Number(x[1]);
    m = Number(x[2]);
    y = Number(x[3]);
    if (y < 100) y += y > 30 ? 1900 : 2000;
  } else {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const t = s.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
    let y1 = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9}) (\d{4})$/.exec(t);
    if (y1) [d, m, y] = [Number(y1[1]), months.indexOf(y1[2].slice(0, 3)) + 1, Number(y1[3])];
    else if ((y1 = /^([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/.exec(t))) [m, d, y] = [months.indexOf(y1[1].slice(0, 3)) + 1, Number(y1[2]), Number(y1[3])];
  }
  if (!y || !m || !d) return undefined;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso || y < 1900 || y > new Date().getUTCFullYear()) return undefined;
  return iso;
}

const goalFrom = (v: string): GoalValue | undefined => {
  const t = v.toLowerCase();
  if (!t) return undefined;
  if (/(fat|weight loss|lose|slim|cut|tone|lean)/.test(t)) return "Fat Loss";
  if (/(muscle|hypertroph|bulk|size|mass|build)/.test(t)) return "Hypertrophy";
  if (/(strength|stronger|power|lift)/.test(t)) return "Strength";
  if (/(condition|cardio|endurance|stamina|fitness test|run|sport)/.test(t)) return "Conditioning";
  return /(general|health|fit|mobility|wellness|active)/.test(t) ? "General Fitness" : undefined;
};
const levelFrom = (v: string): LevelValue | undefined => {
  const t = v.toLowerCase();
  if (/(begin|novice|new|never|first|none|little)/.test(t)) return "Beginner";
  if (/(advanc|expert|years|athlete|compet)/.test(t)) return "Advanced";
  if (/(inter|some|moderate|regular|1-2|1 to 2|2-3)/.test(t)) return "Intermediate";
  return undefined;
};

/** Cleans one candidate from any source. Returns null when there isn't even a name. Unknown or invalid values are dropped. */
export function cleanCandidate(raw: unknown): ClientCandidate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = clean(r.name, 100);
  if (name.length < 2) return null;
  const out: ClientCandidate = { name };
  const phone = clean(r.phone, 40);
  if (phone && /^[0-9+()\-.\s]{6,40}$/.test(phone) && phone.replace(/\D/g, "").length >= 6) out.phone = phone;
  const email = clean(r.email, 200).toLowerCase();
  if (email && EMAIL_RE.test(email)) out.email = email;
  const dob = clean(r.dob, 40);
  const iso = dob ? parseLooseDate(dob) : undefined;
  if (iso) out.dob = iso;
  const goal = typeof r.goal === "string" ? ((GOAL_VALUES as readonly string[]).includes(r.goal) ? (r.goal as GoalValue) : goalFrom(r.goal)) : undefined;
  if (goal) out.goal = goal;
  const level = typeof r.level === "string" ? ((LEVEL_VALUES as readonly string[]).includes(r.level) ? (r.level as LevelValue) : levelFrom(r.level)) : undefined;
  if (level) out.level = level;
  const med = clean(r.medicalNotes, 1500);
  if (med) out.medicalNotes = med;
  const credits = Number(r.credits);
  if (r.credits !== undefined && r.credits !== null && r.credits !== "" && Number.isInteger(credits) && credits >= 0 && credits <= 1000) out.credits = credits;
  const pkg = Number(r.packageSize);
  if (r.packageSize !== undefined && r.packageSize !== null && r.packageSize !== "" && Number.isInteger(pkg) && pkg >= 0 && pkg <= 1000) out.packageSize = pkg;
  const addr = clean(r.homeAddress, 140);
  if (addr) out.homeAddress = addr;
  return out;
}

/* ---------------- A table (spreadsheet, CSV, a pasted grid) ---------------- */
const HEADERS: Record<string, RegExp> = {
  name: /^(full ?name|client ?name|name|client|customer|member|first ?name \+ last ?name)$/i,
  firstName: /^(first ?name|given ?name|forename)$/i,
  lastName: /^(last ?name|surname|family ?name)$/i,
  phone: /^(phone|mobile|contact|contact ?(no|number)|whats ?app|tel|telephone|phone ?(no|number)|hp|cell)$/i,
  email: /^(e-?mail|email ?address|mail)$/i,
  dob: /^(dob|d\.o\.b|date of birth|birth ?date|birthday|born)$/i,
  goal: /^(goals?|main goal|objective|target|aim)$/i,
  level: /^(level|experience|training experience|fitness level|exp)$/i,
  medicalNotes: /^(medical|medical notes?|injur(y|ies)|health|health notes?|conditions?|notes?|remarks?|comments?|pars?-?q|limitations?)$/i,
  credits: /^(credits?|sessions?|session credits?|sessions? left|remaining|balance|package)$/i,
  packageSize: /^(package size|package|pack size|total sessions)$/i,
  homeAddress: /^(address|home address|location)$/i,
};

const splitLine = (line: string, delim: string): string[] => {
  if (delim === "\t") return line.split("\t").map((c) => c.trim());
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === delim && !q) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
};

/** Reads a table with a header row. Returns null when it doesn't look like a table of people (no name column). */
export function parseClientTable(text: string): { candidates: ClientCandidate[]; columns: string[] } | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const count = (c: string) => (lines[0].match(new RegExp(c === "\t" ? "\\t" : c === "|" ? "\\|" : c, "g")) ?? []).length;
  const delim = [",", "\t", ";", "|"].map((c) => ({ c, n: count(c) })).sort((a, b) => b.n - a.n)[0];
  if (!delim || delim.n < 1) return null;
  const header = splitLine(lines[0], delim.c).map((h) => h.replace(/^\|+|\|+$/g, "").trim());
  const col: Partial<Record<keyof typeof HEADERS, number>> = {};
  header.forEach((h, i) => {
    for (const [k, re] of Object.entries(HEADERS)) if (re.test(h.trim()) && col[k as keyof typeof HEADERS] === undefined) col[k as keyof typeof HEADERS] = i;
  });
  if (col.name === undefined && col.firstName === undefined) return null;
  const candidates: ClientCandidate[] = [];
  for (const line of lines.slice(1)) {
    if (/^[\s|:\-]+$/.test(line)) continue; // a markdown table's divider row
    const cells = splitLine(line, delim.c).map((c) => c.replace(/^\|+|\|+$/g, "").trim());
    const at = (k: keyof typeof HEADERS) => (col[k] === undefined ? "" : (cells[col[k]!] ?? ""));
    const name = at("name") || [at("firstName"), at("lastName")].filter(Boolean).join(" ");
    const c = cleanCandidate({ name, phone: at("phone"), email: at("email"), dob: at("dob"), goal: at("goal"), level: at("level"), medicalNotes: at("medicalNotes"), credits: at("credits"), packageSize: at("packageSize"), homeAddress: at("homeAddress") });
    if (c) candidates.push(c);
  }
  return candidates.length ? { candidates: candidates.slice(0, 50), columns: header.filter(Boolean) } : null;
}

/* ---------------- One person written as "Label: value" lines ---------------- */
const LABEL_KEYS: [RegExp, keyof ClientCandidate][] = [
  [/^(full ?name|client ?name|name)$/i, "name"],
  [/^(phone|mobile|contact|whats ?app|tel|hp)( ?(no|number))?$/i, "phone"],
  [/^(e-?mail|email ?address)$/i, "email"],
  [/^(dob|date of birth|birth ?date|birthday)$/i, "dob"],
  [/^(goals?|main goal|objective)$/i, "goal"],
  [/^(level|experience|training experience)$/i, "level"],
  [/^(injur(y|ies)|medical|medical notes?|health|conditions?|notes?)$/i, "medicalNotes"],
  [/^(credits?|session credits?|sessions)$/i, "credits"],
  [/^(package size|package)$/i, "packageSize"],
  [/^(home )?address$/i, "homeAddress"],
];

/** Details written as lines like "Name: Sam Lee", separated by blank lines when there are several people. */
export function parseLabelled(text: string): ClientCandidate[] {
  const blocks = text.split(/\n\s*\n/);
  const out: ClientCandidate[] = [];
  for (const b of blocks) {
    const rec: Record<string, string> = {};
    for (const line of b.split("\n")) {
      const m = /^\s*([A-Za-z .\/#-]{2,30}?)\s*[:=-]\s*(.+)$/.exec(line);
      if (!m) continue;
      const hit = LABEL_KEYS.find(([re]) => re.test(m[1].trim()));
      if (hit && !rec[hit[1]]) rec[hit[1]] = m[2].trim();
    }
    const c = cleanCandidate(rec);
    if (c) out.push(c);
  }
  return out.slice(0, 50);
}

/** Phone numbers and emails found anywhere in free text (used to fill gaps the basic reader left). */
export function sniffContact(text: string): { phone?: string; email?: string } {
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text)?.[0];
  const phone = /(?:\+?\d[\d\s().-]{6,}\d)/.exec(text.replace(email ?? "", ""))?.[0];
  return { ...(email ? { email: email.toLowerCase() } : {}), ...(phone ? { phone: phone.trim() } : {}) };
}

/** Everything the basic (no-AI) reader can do: a table, else labelled lines, else nothing. */
export function readClientsBasic(text: string): { candidates: ClientCandidate[]; how: "table" | "lines" } | null {
  const t = parseClientTable(text);
  if (t) return { candidates: t.candidates, how: "table" };
  const l = parseLabelled(text);
  return l.length ? { candidates: l, how: "lines" } : null;
}

/** What changes if this candidate updates a client: only the fields the candidate actually has and that differ. */
export function diffAgainst(current: Partial<Record<keyof ClientCandidate, string | number | undefined>>, c: ClientCandidate): { key: keyof ClientCandidate; from: string; to: string }[] {
  const out: { key: keyof ClientCandidate; from: string; to: string }[] = [];
  for (const { key } of CANDIDATE_FIELDS) {
    const to = c[key];
    if (to === undefined || to === "") continue;
    const from = current[key];
    const a = from === undefined || from === null ? "" : String(from);
    const b = String(to);
    if (key === "phone" ? phoneKey(a) === phoneKey(b) && a !== "" : a.trim().toLowerCase() === b.trim().toLowerCase()) continue;
    out.push({ key, from: a, to: b });
  }
  return out;
}
