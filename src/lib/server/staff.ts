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
