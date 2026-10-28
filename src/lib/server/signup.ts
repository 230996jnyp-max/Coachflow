import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, gt } from "drizzle-orm";
import { sealProfile, usernameTaken } from "./accounts";
import { hashPassword, type DbRole } from "./auth";
import { decryptJson, encryptJson, tempPassword } from "./crypto";
import { db, isLocalTestMode } from "./db";
import { badRequest, conflict, HttpError, isUniqueViolation, notFound } from "./http";
import { escapeHtml, layout, sendMail, type MailResult } from "./mail";
import { coachSignupRequests, users, type CoachSignupRow, type UserRow } from "./schema";

/*
 * Coach sign-up requests. Anyone can ask for a coach account from the sign-in screen; the owner approves (a coach account is made and
 * the login is emailed straight away) or declines (a polite email with the support address). Clients are never created this way.
 */

export const SUPPORT_EMAIL = "c.darshstrength@gmail.com";
const MAX_PENDING = 50;
const PER_NETWORK_PER_HOUR = 3;

const aad = (id: string) => `signup:${id}`;
/** Gmail only delivers from the signed-in address, so the display name is what we choose. */
const sender = () => `"Coach Darsh — CoachFlow" <${process.env.SMTP_USER || SUPPORT_EMAIL}>`;
/** An email counts as delivered when it was sent (or, in local test mode only, composed). */
const delivered = (m: MailResult) => m.status === "sent" || (m.status === "preview" && isLocalTestMode());

export const hashIp = (ip: string) => createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}|${ip}`).digest("hex").slice(0, 32);

export function parsePhone(v: unknown): string {
  if (typeof v !== "string") throw badRequest("Phone / WhatsApp number is required.");
  const s = v.trim();
  if (!/^[0-9+()\-.\s]{6,30}$/.test(s) || s.replace(/\D/g, "").length < 6) throw badRequest("Phone / WhatsApp number doesn't look valid.");
  return s;
}

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
const when = (d: Date) => d.toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" });

async function ownerAddress(): Promise<string> {
  if (process.env.TRAINER_EMAIL) return process.env.TRAINER_EMAIL;
  const d = await db();
  const [o] = await d.select({ email: users.email }).from(users).where(eq(users.role, "OWNER")).limit(1);
  return o?.email || SUPPORT_EMAIL;
}

const row = (label: string, value: string, mono = false) =>
  `<tr><td style="padding:10px 14px;color:#8892A6;">${escapeHtml(label)}</td><td style="padding:10px 14px;color:#fff;${mono ? "font-family:monospace;" : ""}">${escapeHtml(value)}</td></tr>`;
const table = (rows: string) => `<table style="border-collapse:collapse;background:#1A202E;border-radius:10px;width:100%;">${rows}</table>`;

export function alertMail(r: { fullName: string; email: string; phone: string; at: Date }, origin: string) {
  const link = `${origin}/admin`;
  return {
    subject: `New Coach Account Request: ${r.fullName}`,
    text: `A new coach has asked for an account.\n\nName: ${r.fullName}\nEmail: ${r.email}\nPhone / WhatsApp: ${r.phone}\nSubmitted: ${when(r.at)}\n\nReview it in the Owner Admin Panel (Pending Approvals): ${link}`,
    html: layout(
      "New coach account request",
      `<p style="margin:0 0 12px;color:#E8ECF4;">Someone is waiting for your approval.</p>
       ${table(row("Name", r.fullName) + row("Email", r.email) + row("Phone / WhatsApp", r.phone) + row("Submitted", when(r.at)))}
       <p style="margin:12px 0 0;color:#8892A6;font-size:13px;">Open Pending Approvals and tap the green tick to approve or the red cross to decline.</p>`,
      { label: "Open the Admin Panel", href: link },
    ),
  };
}

export function receivedMail(name: string) {
  return {
    subject: "We received your CoachFlow coach account request",
    text: `Hi ${name},\n\nThanks for asking for a CoachFlow coach account. Your request has been received and is waiting for approval.\n\nAs soon as it is approved, your login details will be emailed to you. Questions? Contact ${SUPPORT_EMAIL}.`,
    html: layout(
      "We received your request",
      `<p style="margin:0 0 12px;color:#E8ECF4;">Hi ${escapeHtml(name)}, thanks for asking for a CoachFlow coach account.</p>
       <p style="margin:0 0 12px;color:#E8ECF4;">Your request is waiting for approval. As soon as it is approved, your login details will be emailed to you right away.</p>
       <p style="margin:0;color:#8892A6;font-size:13px;">Questions? Contact ${escapeHtml(SUPPORT_EMAIL)}.</p>`,
    ),
  };
}

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

/* ---------------- Applicant side ---------------- */
/** A new request. Refuses an email that already has an account or a waiting request, and limits how often one network can ask. */
export async function submitRequest(input: { fullName: string; email: string; phone: string; ip: string }, origin: string): Promise<void> {
  const d = await db();
  const ipHash = hashIp(input.ip);
  const [recent] = await d
    .select({ n: count() })
    .from(coachSignupRequests)
    .where(and(eq(coachSignupRequests.ipHash, ipHash), gt(coachSignupRequests.createdAt, new Date(Date.now() - 3_600_000))));
  if (Number(recent.n) >= PER_NETWORK_PER_HOUR) throw new HttpError(429, "Too many requests from this network. Please try again later.");
  const [pending] = await d.select({ n: count() }).from(coachSignupRequests).where(eq(coachSignupRequests.status, "PENDING"));
  if (Number(pending.n) >= MAX_PENDING) throw new HttpError(503, "We can't take new requests right now. Please try again later.");

  const taken = "This email already has an account or a pending request.";
  if (await usernameTaken(input.email, "")) throw conflict(taken);
  const id = `cr_${randomUUID()}`;
  try {
    await d.insert(coachSignupRequests).values({ id, fullName: input.fullName, email: input.email, phoneEnc: encryptJson({ phone: input.phone }, aad(id)), ipHash });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(taken);
    throw e;
  }

  // Both emails are best effort: the request is saved either way and shows in the admin panel.
  const alert = alertMail({ fullName: input.fullName, email: input.email, phone: input.phone, at: new Date() }, origin);
  const to = await ownerAddress();
  await Promise.all([
    sendMail({ ...alert, to, from: sender() }).catch(() => undefined),
    sendMail({ ...receivedMail(input.fullName), to: input.email, from: sender() }).catch(() => undefined),
  ]);
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
