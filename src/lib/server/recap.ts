import "server-only";
import { eq } from "drizzle-orm";
import { SEED_EXERCISES } from "@/data/exercises";
import { buildRecap, recapText, type Recap } from "@/lib/recap";
import type { Exercise, UnitSystem } from "@/lib/types";
import { loadClientFor, openProfile } from "./accounts";
import { db } from "./db";
import { badRequest, HttpError, notFound } from "./http";
import { escapeHtml, layout, sendMail } from "./mail";
import { globalFor, nichesOf } from "./niche";
import { users, workouts, type UserRow } from "./schema";
import { customExercisesFor, openWorkout } from "./training";

const money = (n: number) => String(n);

function recapHtml(r: Recap): string {
  const tile = (label: string, value: string) => `<td style="padding:12px 8px;text-align:center;background:#1A202E;border-radius:10px;"><div style="font-size:20px;font-weight:700;color:#fff;">${escapeHtml(value || "—")}</div><div style="font-size:11px;color:#8892A6;letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(label)}</div></td>`;
  const prs = r.prs.length
    ? `<p style="margin:18px 0 8px;font-weight:700;color:#F5B83D;">🏆 ${r.prs.length} new personal record${r.prs.length === 1 ? "" : "s"}</p>
       ${r.prs.map((p) => `<div style="background:rgba(245,184,61,.14);border-radius:10px;padding:10px 14px;margin-bottom:6px;color:#fff;"><strong>${escapeHtml(p.exercise)}</strong> <span style="color:#F5B83D;">— ${escapeHtml(p.records.join(", "))}</span></div>`).join("")}`
    : "";
  const notes = r.notes ? `<p style="margin:18px 0 6px;font-size:12px;font-weight:700;color:#8892A6;letter-spacing:.06em;text-transform:uppercase;">Coach notes</p><p style="margin:0;color:#E8ECF4;line-height:1.5;">${escapeHtml(r.notes).replace(/\n/g, "<br>")}</p>` : "";
  const credits = r.credits ? `<p style="margin:18px 0 0;padding:12px 14px;background:#1A202E;border-radius:10px;color:#fff;">🎟️ Sessions left: <strong>${money(r.credits.oneOnOne)}</strong>${r.credits.group ? ` · group classes left: <strong>${money(r.credits.group)}</strong>` : ""}</p>` : "";
  return layout(
    r.title,
    `<p style="margin:0 0 14px;color:#8892A6;">${escapeHtml([r.date, r.duration].filter(Boolean).join(" · "))}${r.focus.length ? ` · ${escapeHtml(r.focus.join(", "))}` : ""}</p>
     <table style="border-collapse:separate;border-spacing:8px 0;width:100%;margin:0 -8px;"><tr>${tile("Exercises", String(r.exercises))}${tile("Sets", String(r.sets))}${tile(r.volume ? "Volume" : "Duration", r.volume || r.duration)}</tr></table>
     ${prs}${notes}${credits}`,
  );
}

/** The exercise library as this person sees it: built-in, the shared niche drills for their coach's niches, and custom ones. */
export async function libraryFor(me: UserRow): Promise<Map<string, Exercise>> {
  const scope = await nichesOf(me);
  const list = [...SEED_EXERCISES, ...(scope ? await globalFor(scope.niches, scope.hidden) : []), ...(await customExercisesFor(me))] as Exercise[];
  return new Map(list.map((e) => [e.id, e]));
}

/** Emails the workout recap to the client's own address (the coach, or the client themself, taps "Email recap"). */
export async function emailRecap(me: UserRow, workoutId: string): Promise<{ to: string }> {
  const d = await db();
  const [row] = await d.select().from(workouts).where(eq(workouts.id, workoutId)).limit(1);
  const w = row ? openWorkout(row) : null;
  if (!w) throw notFound("Workout not found.");
  if (w.status !== "DONE") throw badRequest("Finish the workout first.");
  const clientRow = await loadClientFor(me, w.clientId);
  if (!clientRow) throw notFound("Workout not found.");
  const profile = openProfile(clientRow);
  const to = (profile.email ?? "").trim();
  if (!to) throw badRequest("This client has no email address on file. Add one on their profile first.");

  const exMap = await libraryFor(me);
  const [coach] = clientRow.coachId ? await d.select({ name: users.name }).from(users).where(eq(users.id, clientRow.coachId)).limit(1) : [];
  const recap = buildRecap(w, exMap, {
    brand: "CoachFlow",
    clientName: profile.name,
    focuses: profile.focuses ?? [],
    credits: { oneOnOne: profile.credits, group: profile.groupClassCredits ?? 0 },
    unit: clientRow.unit as UnitSystem,
  });
  const first = profile.name.split(" ")[0] || "there";
  const mail = await sendMail({
    to,
    subject: `Your workout recap: ${recap.title}`,
    text: `Hi ${first},\n\nHere's your recap${coach?.name ? ` from ${coach.name}` : ""}.\n\n${recapText(recap).replace(/\*/g, "")}`,
    html: recapHtml(recap),
  });
  const local = process.env.LOCAL_PGLITE === "1" && !process.env.VERCEL;
  if (!(mail.status === "sent" || (mail.status === "preview" && local))) throw new HttpError(502, `The recap email couldn't be sent${mail.error ? ` (${mail.error})` : ""}. Try again in a moment.`);
  return { to };
}
