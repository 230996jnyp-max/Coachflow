import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { CORE_SPORTS, cleanSports } from "@/lib/sports";
import { checkAge, cleanCoachCode, CLIENT_GOALS, isDisposableEmail, LEVELS, PERSONAL_GOALS, shortName, TRIAL_DAYS, WEEKLY_TARGETS, type Level, type SignupRole } from "@/lib/signupRules";
import type { ClientGoal } from "@/lib/types";
import { openStaffProfile, sealProfile, usernameTaken, parseUsername, openProfile, type ProfileJson, type StaffProfileJson } from "./accounts";
import { issueToken, consumeToken } from "./authTokens";
import { coachByCode, ensureCoachCode } from "./coachCode";
import { requestCoach } from "./coachLinks";
import { hashPassword } from "./auth";
import { db, isLocalTestMode } from "./db";
import { badRequest, checkPassword, conflict, email as parseEmail, HttpError, int, isUniqueViolation, str } from "./http";
import { escapeHtml, layout, sendMail, type MailResult } from "./mail";
import { hit } from "./rateLimit";
import { authTokens, coachSettings, gyms, users, type UserRow } from "./schema";

/*
 * Self sign-up. Anyone can make a Coach, Client or Personal account from /signup. The account exists straight away but can't sign in
 * until the emailed link is opened (so a mistyped or someone else's address never gets in, and a coach is only ever told about
 * people whose address works). Everyone starts a 30-day free trial.
 */

export const SUPPORT_EMAIL = "c.darshstrength@gmail.com";
const sender = () => `"CoachFlow" <${process.env.SMTP_USER || SUPPORT_EMAIL}>`;
/** An email counts as delivered when it was sent (or, in local test mode only, composed). */
const delivered = (m: MailResult) => m.status === "sent" || (m.status === "preview" && isLocalTestMode());

export function parsePhone(v: unknown): string {
  if (typeof v !== "string") throw badRequest("Phone / WhatsApp number is required.");
  const s = v.trim();
  if (!/^[0-9+()\-.\s]{6,30}$/.test(s) || s.replace(/\D/g, "").length < 6) throw badRequest("Phone / WhatsApp number doesn't look valid.");
  return s;
}

const GOAL_MAP: Record<string, ClientGoal> = {
  "Build Strength": "Strength",
  "Improve Sport Performance": "Conditioning",
  "Mobility & Longevity": "General Fitness",
  "Body Recomposition": "Fat Loss",
};

export interface SignupInput {
  role: SignupRole;
  fullName: string;
  username: string;
  email: string;
  password: string;
  phone: string;
  dob: string;
  unit: "metric" | "imperial";
  guardian: boolean;
  niches: string[];
  level: Level | "";
  goal: string;
  experienceYears: number;
  tagline: string;
  gyms: string[];
  coachCode: string;
  medicalNotes: string;
  focuses: string[];
  weeklyTarget: number;
  weightKg: number;
}

const presetNiches = (v: unknown, max: number): string[] => cleanSports(v, max).filter((s) => (CORE_SPORTS as readonly string[]).includes(s));

/** Checks everything the sign-up form sends. Throws a plain-language 400 for the first problem. */
export function parseSignup(body: Record<string, unknown>, now: Date = new Date()): SignupInput {
  const role = body.role;
  if (role !== "COACH" && role !== "CLIENT" && role !== "PERSONAL") throw badRequest("Choose how you'll use CoachFlow.");
  const fullName = str(body.fullName, "Full name", { min: 2, max: 100 });
  const username = parseUsername(body.username, false);
  const address = parseEmail(body.email, "Email address");
  if (isDisposableEmail(address)) throw badRequest("Please use a real email address. Temporary mailboxes can't be used.");
  const password = checkPassword(body.password);
  if (password.toLowerCase().includes(username) && username.length >= 4) throw badRequest("Your password shouldn't contain your username.");
  const phone = parsePhone(body.phone);

  const age = checkAge(body.dob, now);
  if (!age.ok) throw badRequest(age.error);
  if (age.needsGuardian && body.guardian !== true) throw badRequest("Under 18s need a parent or guardian's OK. Tick the box to confirm they agree.");
  if (body.terms !== true) throw badRequest("Please accept the Terms and the Privacy Policy to continue.");

  const unit = body.unit === "imperial" ? "imperial" : "metric";
  const base: SignupInput = {
    role,
    fullName,
    username,
    email: address,
    password,
    phone,
    dob: String(body.dob).trim(),
    unit,
    guardian: age.needsGuardian,
    niches: [],
    level: "",
    goal: "",
    experienceYears: 0,
    tagline: "",
    gyms: [],
    coachCode: "",
    medicalNotes: "",
    focuses: [],
    weeklyTarget: 3,
    weightKg: 0,
  };

  if (role === "COACH") {
    base.niches = presetNiches(body.niches, 6);
    if (base.niches.length === 0) throw badRequest("Pick at least one thing you coach.");
    base.experienceYears = int(body.experienceYears ?? 0, "Years of experience", 0, 60);
    base.tagline = str(body.tagline, "Tagline", { optional: true, max: 140 });
    const places = Array.isArray(body.gyms) ? body.gyms : [];
    base.gyms = places.filter((g): g is string => typeof g === "string").map((g) => g.trim().slice(0, 120)).filter(Boolean).slice(0, 5);
  } else if (role === "CLIENT") {
    const code = cleanCoachCode(body.coachCode);
    if (!code) throw badRequest("Enter your coach's 6-digit code.");
    base.coachCode = code;
    if (!(CLIENT_GOALS as readonly string[]).includes(String(body.goal))) throw badRequest("Pick your main goal.");
    base.goal = String(body.goal);
    if (!(LEVELS as readonly string[]).includes(String(body.level))) throw badRequest("Pick your experience level.");
    base.level = body.level as Level;
    base.medicalNotes = str(body.medicalNotes, "Medical / injury notes", { optional: true, max: 2000 });
    base.focuses = presetNiches(body.focuses, 4);
  } else {
    base.niches = presetNiches(body.niches, 6);
    if (base.niches.length === 0) throw badRequest("Pick at least one thing you train.");
    if (!(LEVELS as readonly string[]).includes(String(body.level))) throw badRequest("Pick your experience level.");
    base.level = body.level as Level;
    if (!(PERSONAL_GOALS as readonly string[]).includes(String(body.goal))) throw badRequest("Pick your main goal.");
    base.goal = String(body.goal);
    const wt = Number(body.weeklyTarget);
    if (!(WEEKLY_TARGETS as readonly number[]).includes(wt)) throw badRequest("Pick how many days a week you want to train.");
    base.weeklyTarget = wt;
    const w = body.weightKg === undefined || body.weightKg === null || body.weightKg === "" ? 0 : Number(body.weightKg);
    if (!Number.isFinite(w) || w < 0 || w > 400) throw badRequest("Body weight doesn't look right.");
    base.weightKg = Math.round(w * 10) / 10;
  }
  return base;
}

/* ---------------- Bot checks ---------------- */
/** Cloudflare Turnstile, when its keys are set (otherwise there is no CAPTCHA and the rate limits and email check do the work). */
export async function verifyCaptcha(token: unknown, ip: string): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return;
  if (typeof token !== "string" || !token) throw badRequest("Please complete the check that you're not a robot.");
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    const j = (await res.json()) as { success?: boolean };
    if (!j.success) throw badRequest("The robot check failed. Please try again.");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, "We couldn't run the robot check. Please try again in a moment.");
  }
}

/* ---------------- Availability ---------------- */
export async function emailInUse(address: string): Promise<boolean> {
  const d = await db();
  const rows = await d.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${address.toLowerCase()}`).limit(1);
  return rows.length > 0 || (await usernameTaken(address.toLowerCase(), ""));
}

export async function availability(input: { username?: string; email?: string }): Promise<{ username?: boolean; email?: boolean }> {
  const out: { username?: boolean; email?: boolean } = {};
  if (input.username) {
    const u = parseUsername(input.username, false);
    out.username = !(await usernameTaken(u, ""));
  }
  if (input.email) {
    const e = parseEmail(input.email);
    out.email = !(await emailInUse(e)) && !isDisposableEmail(e);
  }
  return out;
}

/** What someone sees after typing a coach's code: a first name and the coach's own tagline, never contact details. */
export async function lookupCoach(rawCode: unknown): Promise<{ name: string; tagline: string }> {
  const code = cleanCoachCode(rawCode);
  if (!code) throw badRequest("A coach code is six digits.");
  const coach = await coachByCode(code);
  if (!coach) throw new HttpError(404, "We couldn't find a coach with that code. Check it with your coach.");
  let tagline = "";
  try {
    tagline = openStaffProfile(coach).tagline ?? "";
  } catch {
    tagline = "";
  }
  return { name: shortName(coach.name ?? coach.username), tagline };
}

/* ---------------- Emails ---------------- */
const linkMail = (opts: { subject: string; title: string; intro: string; label: string; href: string; footer: string }) => ({
  subject: opts.subject,
  text: `${opts.intro}\n\n${opts.href}\n\n${opts.footer}`,
  html: layout(
    opts.title,
    `<p style="margin:0 0 12px;color:#E8ECF4;line-height:1.5;">${escapeHtml(opts.intro)}</p>
     <p style="margin:12px 0 0;color:#8892A6;font-size:13px;line-height:1.5;">${escapeHtml(opts.footer)}</p>`,
    { label: opts.label, href: opts.href },
  ),
});

async function sendVerification(user: UserRow, to: string, name: string, origin: string): Promise<MailResult> {
  const token = await issueToken(user.id, "verify");
  const href = `${origin}/verify?token=${encodeURIComponent(token)}`;
  const first = name.trim().split(/\s+/)[0] || "there";
  const m = linkMail({
    subject: "Confirm your CoachFlow email",
    title: "Confirm your email",
    intro: `Hi ${first}, welcome to CoachFlow! Tap the button to confirm your email address and start your 30-day free trial.`,
    label: "Confirm my email",
    href,
    footer: `This link works for 48 hours. If you didn't sign up, you can ignore this email. Questions? ${SUPPORT_EMAIL}`,
  });
  return sendMail({ ...m, to, from: sender() });
}

/* ---------------- Creating the account ---------------- */
export async function createAccount(input: SignupInput, ip: string, origin: string): Promise<{ email: string; role: SignupRole }> {
  await hit(`signup:${ip}`, 5, 3_600_000, "Too many sign-ups from this network. Please try again in an hour.");
  if (await usernameTaken(input.username, "")) throw conflict("That username is taken. Try another.");
  if (await emailInUse(input.email)) throw conflict("That email already has an account. Sign in, or use \"Forgot password\".");

  let coach: UserRow | null = null;
  if (input.role === "CLIENT") {
    coach = await coachByCode(input.coachCode);
    if (!coach) throw new HttpError(404, "We couldn't find a coach with that code. Check it with your coach.");
  }

  const d = await db();
  const id = `u_${randomUUID()}`;
  const consent = { at: new Date().toISOString(), ...(input.guardian ? { guardian: true } : {}) };
  const today = new Date().toISOString().slice(0, 10);
  let profile: ProfileJson | StaffProfileJson;
  if (input.role === "COACH") {
    profile = { phone: input.phone, dob: input.dob, experienceYears: input.experienceYears, ...(input.tagline ? { tagline: input.tagline } : {}), consent: { at: consent.at } };
  } else {
    const personal = input.role === "PERSONAL";
    profile = {
      name: input.fullName,
      phone: input.phone,
      email: input.email,
      goal: personal ? (GOAL_MAP[input.goal] ?? "General Fitness") : (input.goal as ClientGoal),
      credits: 0,
      packageSize: 0,
      defaultGymId: null,
      medicalNotes: input.medicalNotes,
      startDate: today,
      groupClassCredits: 0,
      dob: input.dob,
      level: input.level || undefined,
      consent,
      ...(personal ? { personalGoal: input.goal, weeklyTarget: input.weeklyTarget, ...(input.weightKg ? { startWeightKg: input.weightKg } : {}) } : {}),
      ...(input.focuses.length ? { focuses: input.focuses } : {}),
      ...(coach ? { pendingCoachId: coach.id } : {}),
    };
  }

  let row: UserRow;
  try {
    [row] = await d
      .insert(users)
      .values({
        id,
        role: input.role === "COACH" ? "COACH" : "CLIENT",
        username: input.username,
        passwordHash: await hashPassword(input.password),
        name: input.role === "COACH" ? input.fullName : null,
        email: input.email,
        profileEnc: sealProfile(id, profile),
        coachId: null,
        unit: input.unit,
        mustChangePassword: false,
        emailVerified: false,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
      })
      .returning();
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("That username or email is already taken.");
    throw e;
  }

  const undo = async () => {
    await d.delete(authTokens).where(eq(authTokens.userId, id));
    await d.delete(gyms).where(eq(gyms.coachId, id));
    await d.delete(coachSettings).where(eq(coachSettings.coachId, id));
    await d.delete(users).where(eq(users.id, id));
  };
  try {
    if (input.niches.length) await d.insert(coachSettings).values({ coachId: id, specialties: JSON.stringify(input.niches) }).onConflictDoNothing();
    if (input.role === "COACH") {
      for (const name of input.gyms) await d.insert(gyms).values({ id: `g_${randomUUID()}`, coachId: id, name });
      await ensureCoachCode(row);
    }
    const mail = await sendVerification(row, input.email, input.fullName, origin);
    if (!delivered(mail)) {
      await undo();
      throw new HttpError(502, `We couldn't send the confirmation email${mail.error ? ` (${mail.error})` : ""}. Check the address and try again.`);
    }
  } catch (e) {
    if (!(e instanceof HttpError)) await undo().catch(() => undefined);
    throw e;
  }
  return { email: input.email, role: input.role };
}

/* ---------------- Confirming the email ---------------- */
export async function confirmEmail(rawToken: string): Promise<{ role: SignupRole; joinedCoach: boolean }> {
  const userId = await consumeToken(rawToken, "verify");
  if (!userId) throw badRequest("This link has expired or was already used. Sign in and we'll send you a new one.");
  const d = await db();
  const [row] = await d.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
  if (!row) throw badRequest("This link isn't valid any more.");
  let joinedCoach = false;
  if (row.role === "CLIENT") {
    try {
      const p = openProfile(row);
      if (p.pendingCoachId) {
        const [coach] = await d.select().from(users).where(eq(users.id, p.pendingCoachId)).limit(1);
        if (coach) {
          await requestCoach(row, coach);
          joinedCoach = true;
        }
        delete p.pendingCoachId;
        await d.update(users).set({ profileEnc: sealProfile(row.id, p) }).where(eq(users.id, row.id));
      }
    } catch (e) {
      console.error("Could not send the coach request after confirming", e);
    }
  }
  const personalOrClient: SignupRole = row.role === "COACH" || row.role === "OWNER" ? "COACH" : joinedCoach ? "CLIENT" : "PERSONAL";
  return { role: personalOrClient, joinedCoach };
}

async function findByIdentifier(identifier: string): Promise<UserRow | null> {
  const id = identifier.trim().toLowerCase();
  if (!id || id.length > 200) return null;
  const d = await db();
  const [row] = await d
    .select()
    .from(users)
    .where(sql`${users.username} = ${id} OR lower(${users.email}) = ${id}`)
    .orderBy(sql`(${users.username} = ${id}) DESC`)
    .limit(1);
  return row ?? null;
}

/** Sends the confirmation email again to an account that hasn't confirmed. Says nothing about whether the account exists. */
export async function resendVerification(identifier: string, ip: string, origin: string): Promise<void> {
  await hit(`resend:${ip}`, 6, 3_600_000);
  const row = await findByIdentifier(identifier);
  if (!row || row.emailVerified || !row.email) return;
  try {
    await hit(`resend-user:${row.id}`, 3, 3_600_000);
  } catch {
    return;
  }
  const name = row.role === "CLIENT" ? (() => { try { return openProfile(row).name; } catch { return ""; } })() : (row.name ?? "");
  await sendVerification(row, row.email, name, origin);
}

/* ---------------- Password reset ---------------- */
/** Emails a reset link to the account's address (only accounts that have one on file). Always looks the same from outside. */
export async function startPasswordReset(identifier: string, ip: string, origin: string): Promise<void> {
  await hit(`forgot:${ip}`, 6, 3_600_000);
  const row = await findByIdentifier(identifier);
  if (!row || !row.active || !row.email) return;
  try {
    await hit(`forgot-user:${row.id}`, 3, 3_600_000);
  } catch {
    return;
  }
  const token = await issueToken(row.id, "reset");
  const href = `${origin}/reset?token=${encodeURIComponent(token)}`;
  const m = linkMail({
    subject: "Reset your CoachFlow password",
    title: "Reset your password",
    intro: "Someone asked to reset the password on this CoachFlow account. Tap the button to choose a new one. The link works for one hour.",
    label: "Choose a new password",
    href,
    footer: `If this wasn't you, ignore this email: your password hasn't changed. Questions? ${SUPPORT_EMAIL}`,
  });
  await sendMail({ ...m, to: row.email, from: sender() });
}

export async function finishPasswordReset(rawToken: string, password: unknown): Promise<void> {
  const next = checkPassword(password, "New password");
  const userId = await consumeToken(rawToken, "reset");
  if (!userId) throw badRequest("This reset link has expired or was already used. Ask for a new one.");
  const d = await db();
  await d
    .update(users)
    .set({
      passwordHash: await hashPassword(next),
      // Every device is signed out, and the lock from too many wrong tries is lifted.
      tokenVersion: sql`${users.tokenVersion} + 1`,
      mustChangePassword: false,
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, userId), eq(users.active, true)));
}
