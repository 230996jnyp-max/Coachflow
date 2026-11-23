import "server-only";
import { eq } from "drizzle-orm";
import { listOne, notice, purgeAccount, tell } from "./accountAdmin";
import { assertCanDelete } from "./accountPurge";
import { clearSession, verifyPassword } from "./auth";
import { issueToken, peekToken } from "./authTokens";
import { db } from "./db";
import { badRequest, forbidden, HttpError } from "./http";
import { escapeHtml, layout, sendMail } from "./mail";
import { assertBelow, record } from "./rateLimit";
import { gymOrgs, oauthIdentities, type UserRow } from "./schema";

/*
 * Deleting your own account (required by Google Play and the App Store). The person types their username, and proves it is them with
 * their password or with a link emailed to them (the only way for someone who signs in with Google and never chose a password).
 */

/** True when the person signs in through Google / Facebook / Microsoft, so they may never have chosen a password. */
export async function hasSocialSignIn(userId: string): Promise<boolean> {
  const d = await db();
  const rows = await d.select({ p: oauthIdentities.provider }).from(oauthIdentities).where(eq(oauthIdentities.userId, userId)).limit(1);
  return rows.length > 0;
}

/** What the screen needs to word its warning and offer the right proof. */
export async function deletionInfo(user: UserRow): Promise<{ username: string; canDelete: boolean; social: boolean; role: "coach" | "client" | "solo" | "owner"; hasGym: boolean }> {
  const d = await db();
  const gym = (await d.select({ id: gymOrgs.id }).from(gymOrgs).where(eq(gymOrgs.ownerId, user.id)).limit(1)).length > 0;
  return {
    username: user.username,
    canDelete: user.role !== "OWNER",
    social: await hasSocialSignIn(user.id),
    role: user.role === "OWNER" ? "owner" : user.role === "COACH" ? "coach" : user.coachId ? "client" : "solo",
    hasGym: gym,
  };
}

/** Emails the signed-in person a one-hour link that confirms the deletion (opened while signed in). */
export async function emailDeletionLink(user: UserRow, origin: string): Promise<{ sent: boolean }> {
  if (user.role === "OWNER") throw forbidden("The platform owner account can't be deleted.");
  await assertCanDelete(user);
  const who = await listOne(user);
  if (!who?.email) throw badRequest("There is no email address on this account, so a link can't be sent. Confirm with your password instead.");
  await assertBelow(`delete-link:${user.id}`, 3, 60 * 60_000, "A link was already sent a few times. Please check your inbox, or try again in an hour.");
  await record(`delete-link:${user.id}`);
  const token = await issueToken(user.id, "delete");
  const href = `${origin}/delete-account?token=${encodeURIComponent(token)}`;
  const first = who.name.trim().split(/\s+/)[0] || "there";
  const m = await sendMail({
    to: who.email,
    subject: "[CoachFlow] Confirm deleting your account",
    text: `Hi ${first},\n\nYou asked to delete your CoachFlow account. To go ahead, open this link while you are signed in (it works for one hour):\n${href}\n\nIf this wasn't you, ignore this email and nothing will be deleted.`,
    html: layout(
      "Confirm deleting your account",
      `<p style="margin:0 0 12px;color:#E8ECF4;line-height:1.5;">Hi ${escapeHtml(first)}, you asked to delete your CoachFlow account. To go ahead, open the link below while you are signed in. It works for one hour.</p><p style="margin:0;color:#8892A6;font-size:13px;">If this wasn't you, ignore this email and nothing will be deleted.</p>`,
      { label: "Confirm deletion", href },
    ),
  });
  return { sent: m.status === "sent" || m.status === "preview" };
}

/** Deletes the signed-in person's account after checking the typed username and their proof. Throws on anything wrong; nothing is deleted then. */
export async function deleteOwnAccount(user: UserRow, input: { confirm: string; password?: string; token?: string }): Promise<void> {
  if (user.role === "OWNER") throw forbidden("The platform owner account can't be deleted.");
  if (input.confirm.trim().toLowerCase() !== user.username.toLowerCase()) throw badRequest(`Type your username (${user.username}) exactly to confirm.`);

  await assertBelow(`delete-fail:${user.id}`, 5, 15 * 60_000, "Too many wrong attempts. Please wait a few minutes and try again.");
  let proven = false;
  if (input.token) proven = (await peekToken(input.token, "delete")) === user.id;
  else if (input.password) proven = await verifyPassword(input.password, user.passwordHash);
  else throw badRequest("Enter your password, or use the emailed link, to confirm.");
  if (!proven) {
    await record(`delete-fail:${user.id}`);
    throw new HttpError(401, input.token ? "That link has expired or doesn't belong to this account. Ask for a new one." : "That password isn't right.");
  }

  const who = await listOne(user);
  await purgeAccount(user);
  await clearSession();
  if (who?.email) {
    const first = who.name.trim().split(/\s+/)[0] || "there";
    await tell(who.email, notice({ subject: "Your CoachFlow account has been deleted", title: "Your account has been deleted", lines: [`Hi ${first}, as you asked, your CoachFlow account has been deleted and the information stored in it has been removed. Any CoachFlow subscription has been cancelled.`, "We're sorry to see you go. You are welcome to sign up again any time."] })).catch(() => undefined);
  }
}
