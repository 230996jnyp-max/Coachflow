import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { SUPPORT_EMAIL } from "@/lib/support";
import { cleanSports } from "@/lib/sports";
import { dobOf, openProfile, openStaffProfile } from "./accounts";
import { purgeClientAssessments } from "./assessments";
import { purgeClientAssignments } from "./assignments";
import { purgeClientIntake } from "./intake";
import { issueToken } from "./authTokens";
import { purgeClientBody } from "./bodyData";
import { db } from "./db";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { purgeClientGroups } from "./groups";
import { deleteGymEverything } from "./gymOrg";
import { escapeHtml, layout, sendMail, type MailResult } from "./mail";
import { purgeClientNutrition } from "./nutrition";
import { assertCanDelete, purgeExtras, releaseStripe } from "./accountPurge";
import { sendVerificationFor } from "./signup";
import { purgeClientTraining } from "./training";
import { purgeClientTalk } from "./workoutTalk";
import { ageOn, isMinorAge } from "@/lib/signupRules";
import {
  adminActions,
  aiUsage,
  assessmentPhotos,
  assessments,
  assignments,
  attendance,
  authTokens,
  oauthIdentities,
  bookings,
  calendarTokens,
  clientNotes,
  coachLinks,
  coachSettings,
  creditLog,
  customExercises,
  exerciseTracking,
  groupMembers,
  groupRequests,
  groupSessions,
  gymMembers,
  intakeForms,
  intakeRequests,
  gymOrgs,
  gyms,
  messages,
  notifications,
  savedReplies,
  slots,
  templates,
  userMedia,
  users,
  workoutReactions,
  type UserRow,
} from "./schema";

/*
 * What the owner can do to an account from the Users tab. Names, emails and phone numbers are read so the owner can recognise who is
 * who; workouts, notes, food logs, body data and photos are never read here. Every action is logged, and the person is emailed about it.
 */

export type AccountKind = "coach" | "personal" | "client";

export interface PersonRow {
  id: string;
  kind: AccountKind;
  name: string;
  email: string;
  phone: string;
  username: string;
  verified: boolean;
  active: boolean;
  /** Turned off by the owner (as opposed to a coach archiving a client). */
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  trialEndsAt: string | null;
  age: "adult" | "under 18" | "unknown";
  /** Clients: their coach's name. Coaches: their clients' count, niches and code. */
  coachName?: string;
  /** Clients: the id of their coach (so the owner's list can nest them under that coach). */
  coachId?: string;
  /** A temporary password was issued and not yet replaced (the person has not signed in since). */
  mustChangePassword?: boolean;
  clientCount?: number;
  niches?: string[];
  coachCode?: string;
}

function safeJson(v: string | null): unknown {
  try {
    return v ? JSON.parse(v) : [];
  } catch {
    return [];
  }
}

const kindOf = (r: UserRow): AccountKind => (r.role !== "CLIENT" ? "coach" : r.coachId ? "client" : "personal");

/** The newest accounts (up to `limit`), with the contact details that help the owner recognise them. */
export async function listPeople(limit = 500): Promise<PersonRow[]> {
  const d = await db();
  const rows = await d.select().from(users).where(ne(users.role, "OWNER")).orderBy(sql`${users.createdAt} desc`).limit(limit);
  const coaches = await d.select().from(users).where(inArray(users.role, ["OWNER", "COACH"]));
  const coachName = new Map(coaches.map((c) => [c.id, c.name ?? c.username]));
  const counts = await d.select({ coachId: users.coachId, n: count() }).from(users).where(eq(users.role, "CLIENT")).groupBy(users.coachId);
  const clientsOf = new Map(counts.map((c) => [c.coachId, Number(c.n)]));
  const settings = await d.select().from(coachSettings);
  const nichesOf = new Map(settings.map((s) => [s.coachId, cleanSports(safeJson(s.specialties))]));

  return rows.map((r) => {
    const kind = kindOf(r);
    let name = r.name ?? r.username, email = r.email ?? "", phone = "";
    try {
      if (r.role === "CLIENT") {
        const p = openProfile(r);
        name = p.name || r.username;
        email = p.email || email;
        phone = p.phone ?? "";
      } else phone = openStaffProfile(r).phone ?? "";
    } catch {
      /* an unreadable profile still shows its username */
    }
    const dob = dobOf(r);
    return {
      id: r.id,
      kind,
      name,
      email,
      phone,
      username: r.username,
      verified: r.emailVerified,
      active: r.active,
      disabled: !!r.disabledAt,
      createdAt: r.createdAt.toISOString(),
      lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
      trialEndsAt: r.trialEndsAt ? r.trialEndsAt.toISOString() : null,
      age: !dob ? "unknown" : isMinorAge(ageOn(dob)) ? "under 18" : "adult",
      ...(kind === "client" && r.coachId ? { coachName: coachName.get(r.coachId) ?? "—", coachId: r.coachId } : {}),
      mustChangePassword: r.mustChangePassword,
      ...(kind === "coach" ? { clientCount: clientsOf.get(r.id) ?? 0, niches: nichesOf.get(r.id) ?? [], coachCode: r.coachCode ?? undefined } : {}),
    };
  });
}

/* ---------------- Emails to the person ---------------- */
const sender = () => `"CoachFlow" <${process.env.SMTP_USER || SUPPORT_EMAIL}>`;

export function notice(opts: { subject: string; title: string; lines: string[]; reason?: string; cta?: { label: string; href: string } }) {
  const reason = opts.reason ? `Reason given: ${opts.reason}` : "";
  const tail = `If you have questions, just reply to this email or write to ${SUPPORT_EMAIL}.`;
  const text = [...opts.lines, reason, opts.cta ? opts.cta.href : "", tail].filter(Boolean).join("\n\n");
  const html = layout(
    opts.title,
    [...opts.lines.map((l) => `<p style="margin:0 0 12px;color:#E8ECF4;line-height:1.5;">${escapeHtml(l)}</p>`), reason ? `<p style="margin:0 0 12px;color:#E8ECF4;line-height:1.5;"><strong>${escapeHtml(reason)}</strong></p>` : "", `<p style="margin:12px 0 0;color:#8892A6;font-size:13px;line-height:1.5;">${escapeHtml(tail)}</p>`].join(""),
    opts.cta,
  );
  return { subject: opts.subject, text, html };
}

export async function tell(to: string, m: ReturnType<typeof notice>): Promise<MailResult> {
  return sendMail({ ...m, to, from: sender(), replyTo: SUPPORT_EMAIL });
}

/* ---------------- Deleting everything of someone ---------------- */
async function purgeClient(id: string): Promise<void> {
  const d = await db();
  await d.delete(messages).where(eq(messages.thread, `c:${id}`));
  await purgeClientGroups(id);
  await d.delete(bookings).where(eq(bookings.clientId, id));
  await purgeClientTraining(id);
  await purgeClientTalk(id);
  await purgeClientBody(id);
  await purgeClientAssignments(id);
  await purgeClientNutrition(id);
  await purgeClientIntake(id);
  await purgeClientAssessments(id);
  await d.delete(attendance).where(eq(attendance.clientId, id));
  await d.delete(creditLog).where(eq(creditLog.clientId, id));
  await d.delete(coachLinks).where(eq(coachLinks.clientId, id));
}

/** A coach goes: their clients are kept, as people with no coach (they can ask another coach with a code). Everything the coach owned goes. */
async function purgeCoach(id: string): Promise<void> {
  const d = await db();
  // Forms and assessments this coach held go with them; the clients themselves are kept, as people with no coach.
  const theirs = await d.select({ id: assessments.id }).from(assessments).where(eq(assessments.coachId, id));
  if (theirs.length) await d.delete(assessmentPhotos).where(inArray(assessmentPhotos.assessmentId, theirs.map((a) => a.id)));
  await d.delete(assessments).where(eq(assessments.coachId, id));
  await d.delete(intakeForms).where(eq(intakeForms.coachId, id));
  await d.delete(intakeRequests).where(eq(intakeRequests.coachId, id));
  await d.update(users).set({ coachId: null, updatedAt: new Date() }).where(and(eq(users.role, "CLIENT"), eq(users.coachId, id)));
  const sessions = await d.select({ id: groupSessions.id }).from(groupSessions).where(eq(groupSessions.coachId, id));
  if (sessions.length) {
    const ids = sessions.map((s) => s.id);
    await d.delete(groupMembers).where(inArray(groupMembers.groupId, ids));
    await d.delete(groupRequests).where(inArray(groupRequests.groupId, ids));
    await d.delete(groupSessions).where(inArray(groupSessions.id, ids));
  }
  await d.delete(bookings).where(eq(bookings.coachId, id));
  await d.delete(attendance).where(eq(attendance.coachId, id));
  await d.delete(creditLog).where(eq(creditLog.coachId, id));
  await d.delete(slots).where(eq(slots.coachId, id));
  await d.delete(gyms).where(eq(gyms.coachId, id));
  await d.delete(coachSettings).where(eq(coachSettings.coachId, id));
  await d.delete(assignments).where(eq(assignments.coachId, id));
  await d.delete(clientNotes).where(eq(clientNotes.coachId, id));
  await d.delete(exerciseTracking).where(eq(exerciseTracking.coachId, id));
  await d.delete(templates).where(eq(templates.ownerId, id));
  await d.delete(customExercises).where(eq(customExercises.ownerId, id));
  await d.delete(savedReplies).where(eq(savedReplies.ownerId, id));
  await d.delete(messages).where(eq(messages.thread, `o:${id}`));
  await d.delete(coachLinks).where(eq(coachLinks.coachId, id));
}

export async function purgeAccount(row: UserRow): Promise<void> {
  const d = await db();
  await assertCanDelete(row);
  await releaseStripe(row);
  // A coach who runs a gym takes the gym with them (its other coaches become independent); a member just leaves it.
  for (const g of await d.select({ id: gymOrgs.id }).from(gymOrgs).where(eq(gymOrgs.ownerId, row.id))) await deleteGymEverything(g.id);
  await d.delete(gymMembers).where(eq(gymMembers.userId, row.id));
  if (row.role === "CLIENT") await purgeClient(row.id);
  else await purgeCoach(row.id);
  await d.delete(workoutReactions).where(eq(workoutReactions.userId, row.id));
  await d.delete(notifications).where(eq(notifications.userId, row.id));
  await d.delete(calendarTokens).where(eq(calendarTokens.userId, row.id));
  await d.delete(authTokens).where(eq(authTokens.userId, row.id));
  await d.delete(oauthIdentities).where(eq(oauthIdentities.userId, row.id));
  await d.delete(userMedia).where(eq(userMedia.userId, row.id));
  await d.delete(aiUsage).where(eq(aiUsage.userId, row.id));
  await purgeExtras(row);
  await d.delete(users).where(eq(users.id, row.id));
}

/* ---------------- The actions ---------------- */
export type AccountAction = "disable" | "enable" | "delete" | "resend_verification" | "force_reset";
export const ACCOUNT_ACTIONS: AccountAction[] = ["disable", "enable", "delete", "resend_verification", "force_reset"];

export interface ActionResult {
  ok: true;
  action: AccountAction;
  /** What happened to the email telling them: sent, preview (local test), failed, or skipped (no address on file). */
  email: { status: MailResult["status"] | "skipped"; to?: string; error?: string };
}

export async function applyAccountAction(actor: UserRow, targetId: string, action: AccountAction, opts: { reason?: string; confirmEmail?: string; origin: string }): Promise<ActionResult> {
  const d = await db();
  const [target] = await d.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) throw notFound("That account no longer exists.");
  if (target.role === "OWNER" || target.id === actor.id) throw forbidden("You can't do that to your own account.");

  const person = (await listOne(target)) ?? { name: target.username, email: target.email ?? "" };
  const reason = (opts.reason ?? "").trim().slice(0, 300);
  const first = person.name.trim().split(/\s+/)[0] || "there";
  const to = person.email;
  let mail: MailResult | null = null;
  const label = `${person.name} (${kindOf(target)})`;

  if (action === "disable") {
    if (!target.active) throw conflict("That account is already off.");
    await d.update(users).set({ active: false, disabledAt: new Date(), tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() }).where(eq(users.id, target.id));
    if (to) mail = await tell(to, notice({ subject: "Your CoachFlow account has been disabled", title: "Your account has been disabled", lines: [`Hi ${first}, your CoachFlow account has been disabled by an administrator. You are signed out and can't sign in for now. Nothing has been deleted.`], reason }));
  } else if (action === "enable") {
    if (!target.disabledAt) throw conflict("That account wasn't disabled by an administrator.");
    await d.update(users).set({ active: true, disabledAt: null, updatedAt: new Date() }).where(eq(users.id, target.id));
    if (to) mail = await tell(to, notice({ subject: "Your CoachFlow account is active again", title: "Your account is active again", lines: [`Hi ${first}, your CoachFlow account has been switched back on. You can sign in again with your usual details.`], reason, cta: { label: "Sign in", href: `${opts.origin}/login` } }));
  } else if (action === "delete") {
    const typed = (opts.confirmEmail ?? "").trim().toLowerCase();
    const expected = (to || target.username).toLowerCase();
    if (!typed || typed !== expected) throw badRequest("Type the account's email exactly to confirm the deletion.");
    await purgeAccount(target);
    if (to) mail = await tell(to, notice({ subject: "Your CoachFlow account has been deleted", title: "Your account has been deleted", lines: [`Hi ${first}, your CoachFlow account has been deleted by an administrator, and the information stored in it has been removed.`], reason }));
  } else if (action === "resend_verification") {
    if (target.emailVerified) throw conflict("That email is already confirmed.");
    if (!to) throw badRequest("That account has no email address on file.");
    mail = await sendVerificationFor(target, to, person.name, opts.origin);
  } else if (action === "force_reset") {
    if (!target.active) throw conflict("Switch the account back on first.");
    if (!to) throw badRequest("That account has no email address on file, so a reset link can't be sent.");
    const token = await issueToken(target.id, "reset");
    // Signed out everywhere now; they choose a new password through the link.
    await d.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() }).where(eq(users.id, target.id));
    mail = await tell(to, notice({ subject: "Choose a new CoachFlow password", title: "Choose a new password", lines: [`Hi ${first}, an administrator has asked you to choose a new password. You have been signed out of CoachFlow. The link works for one hour.`], reason, cta: { label: "Choose a new password", href: `${opts.origin}/reset?token=${encodeURIComponent(token)}` } }));
  } else throw badRequest("Unknown action.");

  await d.insert(adminActions).values({ id: `aa_${randomUUID()}`, actorId: actor.id, targetId: target.id, targetLabel: label, action, reason: reason || null });
  return { ok: true, action, email: mail ? { status: mail.status, to: mail.to, error: mail.error } : { status: "skipped" } };
}

export async function listOne(row: UserRow): Promise<{ name: string; email: string } | null> {
  try {
    if (row.role === "CLIENT") {
      const p = openProfile(row);
      return { name: p.name || row.username, email: p.email || row.email || "" };
    }
    return { name: row.name ?? row.username, email: row.email ?? "" };
  } catch {
    return null;
  }
}

/** The latest things the owner did, newest first (for the activity list). */
export async function recentActions(limit = 20) {
  const d = await db();
  const rows = await d.select().from(adminActions).orderBy(sql`${adminActions.at} desc`).limit(limit);
  return rows.map((r) => ({ id: r.id, action: r.action, target: r.targetLabel, reason: r.reason ?? "", at: r.at.toISOString() }));
}

