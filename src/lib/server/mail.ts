import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

export const dataDir = process.env.VERCEL ? "/tmp/coachflow" : path.join(process.cwd(), ".data");

export interface MailResult {
  status: "sent" | "preview" | "failed";
  to: string;
  error?: string;
}

export function smtpConfigured(): boolean {
  // Local test mode never sends real email, whatever is in .env.local.
  if (process.env.LOCAL_PGLITE === "1" && !process.env.VERCEL) return false;
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

// Simple global throttle so a client can't turn the endpoint into a spam cannon.
const sentLog: number[] = [];
function throttled(): boolean {
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (sentLog.length && sentLog[0] < cutoff) sentLog.shift();
  if (sentLog.length >= 300) return true;
  sentLog.push(Date.now());
  return false;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  ics?: { method: "REQUEST" | "CANCEL"; content: string };
}

async function writeOutbox(entry: unknown) {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    const file = path.join(dataDir, "outbox.json");
    let list: unknown[] = [];
    try {
      list = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      list = [];
    }
    list.unshift(entry);
    await fs.writeFile(file, JSON.stringify(list.slice(0, 50), null, 2));
  } catch {
    /* best effort */
  }
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (throttled()) return { status: "failed", to: input.to, error: "Email rate limit reached (300/hour)." };
  const from = process.env.MAIL_FROM || (process.env.SMTP_USER ? `CoachFlow <${process.env.SMTP_USER}>` : "CoachFlow <no-reply@coachflow.local>");
  const message = {
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    ...(input.ics ? { icalEvent: { method: input.ics.method, content: input.ics.content } } : {}),
  };

  if (!smtpConfigured()) {
    // Dry run: compose the full MIME message so the template is verified, but don't deliver.
    try {
      const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
      const info = await t.sendMail(message);
      await writeOutbox({ at: new Date().toISOString(), to: input.to, subject: input.subject, text: input.text, mimeBytes: (info.message as Buffer).length });
    } catch (e) {
      return { status: "failed", to: input.to, error: e instanceof Error ? e.message : "compose failed" };
    }
    return { status: "preview", to: input.to };
  }

  try {
    const port = Number(process.env.SMTP_PORT || 465);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 12000,
    });
    await transport.sendMail(message);
    return { status: "sent", to: input.to };
  } catch (e) {
    return { status: "failed", to: input.to, error: e instanceof Error ? e.message : "send failed" };
  }
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function layout(title: string, bodyHtml: string, cta?: { label: string; href: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#090B10;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
<div style="max-width:520px;margin:0 auto;background:#121620;border:1px solid #262E40;border-radius:16px;overflow:hidden;color:#E8ECF4;">
<div style="padding:18px 24px;background:#3B82F6;font-weight:700;font-size:16px;color:#fff;">CoachFlow</div>
<div style="padding:24px;">
<h2 style="margin:0 0 12px;font-size:18px;color:#fff;">${escapeHtml(title)}</h2>
${bodyHtml}
${cta ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px;">${escapeHtml(cta.label)}</a></p>` : ""}
</div></div></body></html>`;
}
