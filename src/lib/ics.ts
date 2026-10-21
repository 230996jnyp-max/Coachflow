// Pure iCalendar helpers, shared by the browser (downloads / links) and the server (emailed invites).

export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  /** SEQUENCE — increase when an event is changed so calendar apps update instead of duplicating. */
  rev?: number;
  cancelled?: boolean;
  /** Awaiting approval. */
  tentative?: boolean;
}

export interface IcsOptions {
  method?: "PUBLISH" | "REQUEST" | "CANCEL";
  calName?: string;
  organizer?: { name: string; email: string };
  attendee?: { name: string; email: string };
  /** Minutes before the start to raise a reminder in the calendar app. */
  alarms?: number[];
  /** For subscription feeds: how often calendar apps are asked to re-fetch (a hint; Google ignores it). */
  refreshMinutes?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function icsDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const esc = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/** RFC 5545 line folding at 75 octets. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 74) {
      out.push(cur);
      cur = " " + ch;
      bytes = 1 + b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join("\r\n");
}

export function buildIcs(events: IcsEvent[], opts: IcsOptions = {}): string {
  const method = opts.method ?? "PUBLISH";
  const alarms = opts.alarms ?? [1440, 60];
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CoachFlow//PT Sessions//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
  ];
  if (opts.calName) lines.push(`X-WR-CALNAME:${esc(opts.calName)}`);
  if (opts.refreshMinutes) lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${opts.refreshMinutes}M`, `X-PUBLISHED-TTL:PT${opts.refreshMinutes}M`);
  const stamp = icsDate(new Date());
  for (const e of events) {
    const cancelled = e.cancelled || method === "CANCEL";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@coachflow`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${esc(e.summary)}`,
      `SEQUENCE:${e.rev ?? 0}`,
      `STATUS:${cancelled ? "CANCELLED" : e.tentative ? "TENTATIVE" : "CONFIRMED"}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (opts.organizer) lines.push(`ORGANIZER;CN=${esc(opts.organizer.name)}:mailto:${opts.organizer.email}`);
    if (opts.attendee)
      lines.push(`ATTENDEE;CN=${esc(opts.attendee.name)};RSVP=FALSE;PARTSTAT=ACCEPTED:mailto:${opts.attendee.email}`);
    if (!cancelled) {
      for (const m of alarms) {
        lines.push(
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${esc(e.summary)}`,
          `TRIGGER:-PT${m}M`,
          "END:VALARM",
        );
      }
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(e: IcsEvent): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.summary,
    dates: `${icsDate(e.start)}/${icsDate(e.end)}`,
    details: e.description ?? "",
    location: e.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function outlookCalendarUrl(e: IcsEvent): string {
  const q = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: e.summary,
    startdt: e.start.toISOString(),
    enddt: e.end.toISOString(),
    body: e.description ?? "",
    location: e.location ?? "",
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q.toString()}`;
}

export function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
