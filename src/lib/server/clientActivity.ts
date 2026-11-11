import "server-only";
import { eq } from "drizzle-orm";
import { workoutSetCount } from "@/lib/stats";
import type { Workout } from "@/lib/types";
import { toUser } from "./accounts";
import { tryAiQuota } from "./aiQuota";
import { db } from "./db";
import { notify } from "./groups";
import { escapeHtml, layout, sendMail } from "./mail";
import { libraryFor } from "./recap";
import { users, type UserRow } from "./schema";

/*
 * When a client finishes a workout or imports one, their coach is told: an in-app notification every time, and an email when it was
 * an import or the workout set a new personal record. A client's saved routines stay private to them: the coach is told one was
 * saved, but cannot open it. A small daily limit keeps a client from flooding their coach's inbox.
 */

const EMAILS_PER_CLIENT_PER_DAY = 6;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function coachOf(me: UserRow): Promise<UserRow | null> {
  if (me.role !== "CLIENT" || !me.coachId) return null;
  const d = await db();
  const [c] = await d.select().from(users).where(eq(users.id, me.coachId)).limit(1);
  return c ?? null;
}

async function emailCoach(coach: UserRow, clientId: string, subject: string, text: string, html: string): Promise<void> {
  const to = coach.email ?? "";
  if (!to) return;
  if (!(await tryAiQuota(clientId, "coach_email", EMAILS_PER_CLIENT_PER_DAY))) return;
  void sendMail({ to, subject, text, html }).catch(() => undefined);
}

/** Called after a client's workout is saved as finished for the first time (never for ones the coach logged). */
export async function announceWorkout(me: UserRow, w: Workout, origin: string): Promise<void> {
  try {
    const coach = await coachOf(me);
    if (!coach || w.status !== "DONE" || w.clientId !== me.id || w.loggedById !== me.id) return;
    const name = toUser(me).name;
    const first = name.split(" ")[0] || "A client";
    const exMap = await libraryFor(me);
    const sets = workoutSetCount(w);
    const prs = w.exercises.flatMap((we) => we.sets.filter((s) => s.done && s.pr?.length).map(() => we.exerciseId));
    const prCount = prs.length;
    const verb = w.imported ? "imported" : "logged";
    const title = w.title || "a workout";
    const body = `${name} just ${verb} “${title}” (${plural(w.exercises.length, "exercise")}, ${plural(prCount, "PR")}).`;
    const link = `/workout/${w.id}`;
    await notify([coach.id], "client_workout", { title: `${first} ${verb} a workout`, body, link, about: me.id }, { email: false });

    // Email only for imports and for workouts with a new personal record.
    if (!w.imported && prCount === 0) return;
    const lines = w.exercises.map((we) => {
      const ex = exMap.get(we.exerciseId);
      const done = we.sets.filter((s) => s.done && s.type !== "W").length;
      const prs2 = we.sets.some((s) => s.pr?.length) ? " 🏆 PR" : "";
      return `${ex?.name ?? "Exercise"} — ${plural(done, "set")}${prs2}`;
    });
    const url = `${origin}${link}`;
    await emailCoach(
      coach,
      me.id,
      `${first} ${verb} a workout: ${title}`,
      `${body}\n\n${lines.map((l) => `• ${l}`).join("\n")}\n\n${plural(sets, "set")} in total. View it: ${url}`,
      layout(
        `${first} ${verb} a workout`,
        `<p style="margin:0 0 12px;color:#E8ECF4;">${escapeHtml(body)}</p>
         <ul style="margin:0;padding-left:18px;color:#E8ECF4;line-height:1.6;">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
         <p style="margin:12px 0 0;color:#8892A6;font-size:13px;">${escapeHtml(plural(sets, "set"))} in total${prCount ? ` · ${escapeHtml(plural(prCount, "new PR"))}` : ""}.</p>`,
        { label: "View the workout", href: url },
      ),
    );
  } catch (e) {
    console.error("announceWorkout failed", e);
  }
}

/** A client saved imported routines (private to them): the coach is told how many, not what is in them. */
export async function announceRoutines(me: UserRow, titles: string[], exercises: number, origin: string): Promise<void> {
  try {
    const coach = await coachOf(me);
    if (!coach) return;
    const name = toUser(me).name;
    const first = name.split(" ")[0] || "A client";
    const clean = titles.map((t) => t.replace(/\s+/g, " ").trim().slice(0, 80)).filter(Boolean).slice(0, 5);
    const body = `${name} imported ${plural(titles.length, "routine")} with AI${clean.length ? `: ${clean.map((t) => `“${t}”`).join(", ")}` : ""} (${plural(exercises, "exercise")}). Imported routines are private to the client.`;
    await notify([coach.id], "client_import", { title: `${first} imported a routine`, body, link: `/clients/${me.id}`, about: me.id }, { email: false });
    const url = `${origin}/clients/${me.id}`;
    await emailCoach(coach, me.id, `${first} imported a routine`, `${body}\n\nOpen their profile: ${url}`, layout(`${first} imported a routine`, `<p style="margin:0;color:#E8ECF4;line-height:1.5;">${escapeHtml(body)}</p>`, { label: "Open the client", href: url }));
  } catch (e) {
    console.error("announceRoutines failed", e);
  }
}

