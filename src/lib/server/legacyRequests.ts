import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { sealProfile, usernameTaken } from "./accounts";
import { hashPassword, type DbRole } from "./auth";
import { decryptJson, tempPassword } from "./crypto";
import { db, isLocalTestMode } from "./db";
import { conflict, HttpError, isUniqueViolation, notFound } from "./http";
import { escapeHtml, layout, sendMail, type MailResult } from "./mail";
import { coachSignupRequests, users, type CoachSignupRow, type UserRow } from "./schema";

/*
 * Coach sign-up requests from before self sign-up existed. Nobody can send a new one any more (sign-up creates the account straight
 * away), but a request that was still waiting can be approved or declined here, so nobody is left hanging.
 */

export const SUPPORT_EMAIL = "c.darshstrength@gmail.com";

const aad = (id: string) => `signup:${id}`;
/** Gmail only delivers from the signed-in address, so the display name is what we choose. */
const sender = () => `"Coach Darsh — CoachFlow" <${process.env.SMTP_USER || SUPPORT_EMAIL}>`;
/** An email counts as delivered when it was sent (or, in local test mode only, composed). */
const delivered = (m: MailResult) => m.status === "sent" || (m.status === "preview" && isLocalTestMode());

export interface SignupRequest {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  reviewedAt: string | null;
}

function toRequest(r: CoachSignupRow): SignupRequest {
  let phone = "";
  try {
    phone = decryptJson<{ phone: string }>(r.phoneEnc, aad(r.id)).phone;
  } catch {
    phone = "";
  }
  return { id: r.id, fullName: r.fullName, email: r.email, phone, status: r.status as SignupRequest["status"], createdAt: r.createdAt.toISOString(), reviewedAt: r.reviewedAt?.toISOString() ?? null };
}

/* ---------------- Emails ---------------- */

const row = (label: string, value: string, mono = false) =>
  `<tr><td style="padding:10px 14px;color:#8892A6;">${escapeHtml(label)}</td><td style="padding:10px 14px;color:#fff;${mono ? "font-family:monospace;" : ""}">${escapeHtml(value)}</td></tr>`;
const table = (rows: string) => `<table style="border-collapse:collapse;background:#1A202E;border-radius:10px;width:100%;">${rows}</table>`;

export function approvedMail(name: string, email: string, password: string, origin: string) {
  const link = `${origin}/login`;
  return {
    subject: "Your Coach Account Is Approved — Here Are Your Login Details",
    text: `Hi ${name},\n\nGood news: your CoachFlow coach account has been approved.\n\nLogin: ${link}\nUsername / Email: ${email}\nTemporary password: ${password}\n\nPlease sign in and set your own personal password. Questions? Contact ${SUPPORT_EMAIL}.`,
    html: layout(
      "Your coach account is approved",
      `<p style="margin:0 0 12px;color:#E8ECF4;">Hi ${escapeHtml(name)}, your CoachFlow coach account has been approved.</p>
       ${table(row("Login", link, true) + row("Username / Email", email, true) + row("Temporary password", password, true))}
       <p style="margin:12px 0 0;color:#8892A6;font-size:13px;">Sign in and set your own personal password. Questions? Contact ${escapeHtml(SUPPORT_EMAIL)}.</p>`,
      { label: "Sign in to CoachFlow", href: link },
    ),
  };
}

export function declinedMail(name: string) {
  return {
    subject: "Update on Your CoachFlow Account Request",
    text: `Hi ${name},\n\nThank you for your interest in CoachFlow. Your coach account request was not approved at this time.\n\nIf you have any questions or would like to reach out for support, please contact ${SUPPORT_EMAIL}.`,
    html: layout(
      "Update on your account request",
      `<p style="margin:0 0 12px;color:#E8ECF4;">Hi ${escapeHtml(name)}, thank you for your interest in CoachFlow.</p>
       <p style="margin:0 0 12px;color:#E8ECF4;">Your coach account request was <strong>not approved</strong> at this time.</p>
       <p style="margin:0;color:#8892A6;font-size:13px;">If you have any questions or would like to reach out for support, please contact <strong style="color:#fff;">${escapeHtml(SUPPORT_EMAIL)}</strong>.</p>`,
    ),
  };
}

/* ---------------- Owner side ---------------- */
export async function listRequests(): Promise<{ requests: SignupRequest[]; pending: number }> {
  const d = await db();
  const rows = await d.select().from(coachSignupRequests).orderBy(desc(coachSignupRequests.createdAt)).limit(200);
  const requests = rows.map(toRequest);
  return { requests, pending: requests.filter((r) => r.status === "PENDING").length };
}

export async function pendingCount(): Promise<number> {
  const d = await db();
  const [r] = await d.select({ n: count() }).from(coachSignupRequests).where(eq(coachSignupRequests.status, "PENDING"));
  return Number(r.n);
}

/**
 * Green tick: makes the coach account (temporary password, must change it on first login) and emails the login. If that email can't
 * be sent, the account is removed again and the request stays pending, so nobody is left approved without their login.
 */
export async function approveRequest(owner: UserRow, requestId: string, origin: string): Promise<SignupRequest> {
  const d = await db();
  const [req] = await d.select().from(coachSignupRequests).where(eq(coachSignupRequests.id, requestId)).limit(1);
  if (!req) throw notFound("Request not found.");
  if (req.status !== "PENDING") throw conflict("That request was already answered.");
  const clash = "Someone already has an account with this email, so it can't be approved.";
  if (await usernameTaken(req.email, "")) throw conflict(clash);

  const password = tempPassword();
  const id = `u_${randomUUID()}`;
  try {
    await d.insert(users).values({
      id,
      role: "COACH" satisfies DbRole,
      username: req.email,
      passwordHash: await hashPassword(password),
      name: req.fullName,
      email: req.email,
      profileEnc: sealProfile(id, {}),
      mustChangePassword: true,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(clash);
    throw e;
  }

  const mail = await sendMail({ ...approvedMail(req.fullName, req.email, password, origin), to: req.email, from: sender() });
  if (!delivered(mail)) {
    await d.delete(users).where(eq(users.id, id));
    throw new HttpError(502, `The approval email couldn't be sent${mail.error ? ` (${mail.error})` : ""}, so no account was created and the request is still pending. Check the email address and try again.`);
  }
  const [done] = await d
    .update(coachSignupRequests)
    .set({ status: "APPROVED", reviewedAt: new Date(), reviewedBy: owner.id, coachId: id })
    .where(and(eq(coachSignupRequests.id, requestId), eq(coachSignupRequests.status, "PENDING")))
    .returning();
  return toRequest(done ?? req);
}

/** Red cross: marks the request declined and emails the applicant (the decision stands even if that email can't be delivered). */
export async function declineRequest(owner: UserRow, requestId: string): Promise<{ request: SignupRequest; emailed: boolean }> {
  const d = await db();
  const [done] = await d
    .update(coachSignupRequests)
    .set({ status: "REJECTED", reviewedAt: new Date(), reviewedBy: owner.id })
    .where(and(eq(coachSignupRequests.id, requestId), eq(coachSignupRequests.status, "PENDING")))
    .returning();
  if (!done) {
    const [req] = await d.select().from(coachSignupRequests).where(eq(coachSignupRequests.id, requestId)).limit(1);
    if (!req) throw notFound("Request not found.");
    throw conflict("That request was already answered.");
  }
  const mail = await sendMail({ ...declinedMail(done.fullName), to: done.email, from: sender() });
  return { request: toRequest(done), emailed: delivered(mail) };
}
