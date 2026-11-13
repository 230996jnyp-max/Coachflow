import "server-only";
import { escapeHtml, layout, sendMail, type MailResult } from "./mail";

/** Emails a new (or reset) coach their temporary login. The password is only ever sent to that coach's own address. */
export async function sendCredentialsEmail(opts: { to: string; name: string; username: string; password: string; origin: string; reset?: boolean; asOwner?: boolean }): Promise<MailResult> {
  const { to, name, username, password, origin, reset, asOwner } = opts;
  const first = name.split(" ").pop() ?? name;
  return sendMail({
    to,
    subject: reset ? "[CoachFlow] Your password was reset" : "[CoachFlow] Your coach account is ready",
    text: `Hi ${first},\n\n${reset ? "Your CoachFlow password was reset." : `Your CoachFlow ${asOwner ? "owner" : "coach"} account has been created.`}\n\nLogin: ${origin}/login\nUsername: ${username}\nTemporary password: ${password}\n\nYou will be asked to choose your own password the first time you log in.`,
    html: layout(
      reset ? "Your password was reset" : "Your coach account is ready",
      `<p style="margin:0 0 12px;color:#E8ECF4;">Hi ${escapeHtml(first)}, ${reset ? "a new temporary password was set for your account." : `your CoachFlow ${asOwner ? "owner" : "coach"} account has been created.`}</p>
       <table style="border-collapse:collapse;background:#1A202E;border-radius:10px;width:100%;"><tr><td style="padding:10px 14px;color:#8892A6;">Username</td><td style="padding:10px 14px;color:#fff;font-family:monospace;">${escapeHtml(username)}</td></tr>
       <tr><td style="padding:10px 14px;color:#8892A6;">Temporary password</td><td style="padding:10px 14px;color:#fff;font-family:monospace;">${escapeHtml(password)}</td></tr></table>
       <p style="margin:12px 0 0;color:#8892A6;font-size:13px;">You'll be asked to choose your own password the first time you log in. Delete this email afterwards.</p>`,
      { label: "Open CoachFlow", href: `${origin}/login` },
    ),
  });
}

/**
 * A new client's login, from their coach. With `pack`, the same email also asks them to fill in the "Before we meet" forms, so one
 * email covers both. The temporary password must be changed at first login.
 */
export async function sendClientLoginEmail(opts: { to: string; name: string; coachName: string; username: string; password: string; origin: string; pack?: boolean }): Promise<MailResult> {
  const { to, name, coachName, username, password, origin, pack } = opts;
  const first = name.trim().split(/\s+/)[0] || "there";
  const packText = pack ? `\n\nBefore your first session, please sign in and fill in a few short forms (a health questionnaire, a declaration and your goals). It takes about five minutes and helps ${coachName} plan for you.` : "";
  return sendMail({
    to,
    subject: pack ? `[CoachFlow] ${coachName} set you up, and a few forms to fill in` : `[CoachFlow] ${coachName} set up your login`,
    text: `Hi ${first},\n\n${coachName} added you on CoachFlow.\n\nLogin: ${origin}/login\nUsername: ${username}\nTemporary password: ${password}\n\nYou will be asked to choose your own password the first time you sign in.${packText}`,
    html: layout(
      pack ? "Your login, and a few forms" : "Your login is ready",
      `<p style="margin:0 0 12px;color:#E8ECF4;">Hi ${escapeHtml(first)}, ${escapeHtml(coachName)} added you on CoachFlow.</p>
       <table style="border-collapse:collapse;background:#1A202E;border-radius:10px;width:100%;"><tr><td style="padding:10px 14px;color:#8892A6;">Username</td><td style="padding:10px 14px;color:#fff;font-family:monospace;">${escapeHtml(username)}</td></tr>
       <tr><td style="padding:10px 14px;color:#8892A6;">Temporary password</td><td style="padding:10px 14px;color:#fff;font-family:monospace;">${escapeHtml(password)}</td></tr></table>
       <p style="margin:12px 0 0;color:#8892A6;font-size:13px;">You'll be asked to choose your own password the first time you sign in.</p>${pack ? `<p style="margin:14px 0 0;color:#E8ECF4;line-height:1.5;">Before your first session, please sign in and fill in a few short forms (a health questionnaire, a declaration and your goals). It takes about five minutes and helps ${escapeHtml(coachName)} plan for you.</p>` : ""}`,
      { label: pack ? "Sign in and fill in the forms" : "Open CoachFlow", href: `${origin}/login` },
    ),
  });
}
