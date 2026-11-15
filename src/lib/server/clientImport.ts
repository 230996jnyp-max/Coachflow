import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { CANDIDATE_FIELDS, cleanCandidate, emailKey, phoneKey, readClientsBasic, type ClientCandidate } from "@/lib/clientImport";
import { ageOn, isMinorAge } from "@/lib/signupRules";
import { loadClientFor, openProfile, sealProfile, toProfile, toUser, usernameTaken, type ProfileJson } from "./accounts";
import { aiConfigured, aiReadClients } from "./ai";
import { logAiUsage } from "./aiLog";
import { takeAiQuota } from "./aiQuota";
import { hashPassword } from "./auth";
import { tempPassword } from "./crypto";
import { logCredit } from "./credits";
import { db } from "./db";
import { badRequest, forbidden, notFound } from "./http";
import { applyHomeAddress } from "./schedule";
import { users, type UserRow } from "./schema";
import { sendClientLoginEmail } from "./staff";

/*
 * Import client details, like importing workouts: read some text or a table into candidate clients, let the coach review them (new, or
 * an update to someone they already have), then save only what they approved. A blank value never erases anything, a login is made
 * for each new client (never read from the file), and an under-18 needs the coach to confirm guardian consent.
 */

export interface CurrentValues {
  name: string;
  phone: string;
  email: string;
  dob: string;
  goal: string;
  level: string;
  medicalNotes: string;
  credits: number;
  packageSize: number;
  homeAddress: string;
}

export interface ImportCandidate extends ClientCandidate {
  /** Someone the coach already has with this phone or email (or the person the coach is updating). */
  match?: { clientId: string; current: CurrentValues };
  /** The same person appears twice in this list. */
  duplicateInList?: boolean;
  /** Under 18 (from the birth date), so a guardian's consent is needed to create or change them. */
  minor?: boolean;
}

const currentOf = (row: UserRow): CurrentValues => {
  const p = openProfile(row);
  return { name: p.name, phone: p.phone ?? "", email: p.email ?? "", dob: p.dob ?? "", goal: p.goal, level: p.level ?? "", medicalNotes: p.medicalNotes ?? "", credits: p.credits, packageSize: p.packageSize, homeAddress: p.homeText ?? p.homePlace?.name ?? "" };
};

export async function readClients(me: UserRow, input: { text: unknown; targetClientId?: unknown }): Promise<{ candidates: ImportCandidate[]; via: "table" | "lines" | "ai"; note?: string }> {
  if (me.role === "CLIENT") throw forbidden("Only a coach can import clients.");
  const text = typeof input.text === "string" ? input.text.trim().slice(0, 20000) : "";
  if (text.length < 3) throw badRequest("Paste some client details first.");

  let candidates: ClientCandidate[] = [];
  let via: "table" | "lines" | "ai" = "lines";
  let note: string | undefined;
  const basic = readClientsBasic(text);
  // A real table, or clearly labelled lines, is read exactly as written (fast, free, and nothing is guessed).
  if (basic && (basic.how === "table" || basic.candidates.length > 0)) {
    candidates = basic.candidates;
    via = basic.how;
  } else if (aiConfigured()) {
    try {
      await takeAiQuota(me.id, "client_import", 30, "client imports");
      await logAiUsage({ userId: me.id, feature: "client_details_import" });
      candidates = (await aiReadClients(text)).map((c) => cleanCandidate(c)).filter((c): c is ClientCandidate => !!c);
      via = "ai";
    } catch (e) {
      note = e instanceof Error ? e.message : "The AI couldn't read that.";
    }
  } else note = "AI reading isn't set up, so only tables and \"Name: value\" lines can be read.";
  if (!candidates.length) throw badRequest(note ? `I couldn't find any clients in that. ${note}` : "I couldn't find any clients in that. Try one client per row with a header row (Name, Phone, Email ...), or lines like \"Name: Sam Lee\".");

  const d = await db();
  const own = await d.select().from(users).where(and(eq(users.role, "CLIENT"), eq(users.coachId, me.id)));
  const rows = own.map((r) => ({ row: r, cur: (() => { try { return currentOf(r); } catch { return null; } })() })).filter((x): x is { row: UserRow; cur: CurrentValues } => !!x.cur);
  let target: { row: UserRow; cur: CurrentValues } | null = null;
  if (typeof input.targetClientId === "string" && input.targetClientId) {
    const t = await loadClientFor(me, input.targetClientId);
    if (!t) throw notFound("Client not found.");
    target = { row: t, cur: currentOf(t) };
  }

  const seen = new Set<string>();
  const out: ImportCandidate[] = candidates.slice(0, 50).map((c, i) => {
    const pk = phoneKey(c.phone), ek = emailKey(c.email);
    const key = pk.length >= 6 ? `p${pk}` : ek ? `e${ek}` : `n${c.name.toLowerCase()}`;
    const dup = seen.has(key);
    seen.add(key);
    const hit = target && i === 0 ? target : rows.find((x) => (pk.length >= 6 && phoneKey(x.cur.phone) === pk) || (ek && emailKey(x.cur.email) === ek));
    return { ...c, ...(hit ? { match: { clientId: hit.row.id, current: hit.cur } } : {}), ...(dup ? { duplicateInList: true } : {}), ...(c.dob && isMinorAge(ageOn(c.dob)) ? { minor: true } : {}) };
  });
  return { candidates: out, via, note };
}

/* ---------------- Saving what the coach approved ---------------- */
export interface ImportRow {
  action: "create" | "update" | "skip";
  clientId?: string;
  /** For an update: only the fields the coach ticked. */
  fields: ClientCandidate;
  sendLogin?: boolean;
  /** The coach confirms a parent or guardian agrees (for someone under 18). */
  guardian?: boolean;
}

export interface ImportResult {
  index: number;
  ok: boolean;
  action: "create" | "update" | "skip";
  name: string;
  clientId?: string;
  username?: string;
  password?: string;
  emailed?: "sent" | "preview" | "failed" | "none";
  error?: string;
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 24);

async function freeUsername(name: string): Promise<string> {
  const base = slug(name).length >= 3 ? slug(name) : `client${slug(name)}`.slice(0, 24);
  if (!(await usernameTaken(base, ""))) return base;
  for (let i = 0; i < 30; i++) {
    const u = `${base.slice(0, 26)}${randomInt(10, 999)}`;
    if (!(await usernameTaken(u, ""))) return u;
  }
  throw badRequest("Couldn't make a free username. Try again.");
}

function applyFields(p: ProfileJson, f: ClientCandidate): void {
  if (f.name) p.name = f.name;
  if (f.phone) p.phone = f.phone;
  if (f.email) p.email = f.email;
  if (f.dob) p.dob = f.dob;
  if (f.goal) p.goal = f.goal;
  if (f.level) p.level = f.level;
  if (f.medicalNotes) p.medicalNotes = f.medicalNotes;
  if (f.packageSize !== undefined) p.packageSize = f.packageSize;
  if (f.homeAddress) applyHomeAddress(p, { text: f.homeAddress });
}

export async function commitClients(me: UserRow, rows: ImportRow[], origin: string): Promise<ImportResult[]> {
  if (me.role === "CLIENT") throw forbidden("Only a coach can import clients.");
  if (!Array.isArray(rows) || rows.length === 0) throw badRequest("Nothing to import.");
  if (rows.length > 50) throw badRequest("Import up to 50 clients at a time.");
  const d = await db();
  const results: ImportResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const f = cleanCandidate(r.fields);
    const base = { index: i, action: r.action, name: f?.name ?? "" };
    try {
      if (r.action === "skip") {
        results.push({ ...base, ok: true });
        continue;
      }
      if (!f) throw badRequest("A name is needed.");
      const minor = !!f.dob && isMinorAge(ageOn(f.dob));
      if (minor && r.guardian !== true) throw badRequest("Under 18: tick that a parent or guardian agrees.");
      if (r.action === "create") {
        const id = `u_${randomUUID()}`;
        const username = await freeUsername(f.name);
        const password = tempPassword();
        const profile: ProfileJson = {
          name: f.name,
          phone: f.phone ?? "",
          email: f.email ?? "",
          goal: f.goal ?? "General Fitness",
          credits: f.credits ?? 0,
          packageSize: f.packageSize ?? f.credits ?? 0,
          defaultGymId: null,
          medicalNotes: f.medicalNotes ?? "",
          startDate: new Date().toISOString().slice(0, 10),
          groupClassCredits: 0,
          ...(f.dob ? { dob: f.dob } : {}),
          ...(f.level ? { level: f.level } : {}),
          ...(minor ? { consent: { at: new Date().toISOString(), guardian: true } } : {}),
        };
        if (f.homeAddress) applyHomeAddress(profile, { text: f.homeAddress });
        await d.insert(users).values({ id, role: "CLIENT", username, passwordHash: await hashPassword(password), profileEnc: sealProfile(id, profile), coachId: me.id, mustChangePassword: true });
        if (profile.credits > 0) await logCredit({ clientId: id, coachId: me.id, pool: "SESSION", kind: "OPENING", delta: profile.credits, sessionType: "1-on-1 PT", label: "Starting package (imported)", balance: profile.credits });
        let emailed: ImportResult["emailed"] = "none";
        if (r.sendLogin && f.email) {
          const m = await sendClientLoginEmail({ to: f.email, name: f.name, coachName: me.name ?? "Your coach", username, password, origin });
          emailed = m.status;
        }
        results.push({ ...base, ok: true, clientId: id, username, password, emailed });
        continue;
      }
      // update
      const row = await loadClientFor(me, r.clientId ?? "");
      if (!row) throw notFound("That client wasn't found.");
      const p = openProfile(row);
      const before = p.credits;
      applyFields(p, f);
      if (f.credits !== undefined) p.credits = f.credits;
      if (minor) p.consent = { at: p.consent?.at ?? new Date().toISOString(), guardian: true };
      await d.update(users).set({ profileEnc: sealProfile(row.id, p), updatedAt: new Date() }).where(and(eq(users.id, row.id), eq(users.coachId, me.id)));
      if (p.credits !== before) await logCredit({ clientId: row.id, coachId: me.id, pool: "SESSION", kind: "ADJUSTMENT", delta: p.credits - before, sessionType: "1-on-1 PT", label: "Updated from an import", balance: p.credits });
      results.push({ ...base, ok: true, clientId: row.id });
    } catch (e) {
      results.push({ ...base, ok: false, error: e instanceof Error ? e.message : "That row couldn't be saved." });
    }
  }
  return results;
}

/** For the client page and the add-client form after an import: the fresh client and profile. */
export async function clientView(row: UserRow) {
  return { user: toUser(row), profile: toProfile(row) };
}

export const IMPORT_FIELD_KEYS = CANDIDATE_FIELDS.map((f) => f.key);
