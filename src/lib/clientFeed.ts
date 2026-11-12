import { parseISO } from "date-fns";
import { attendedClass } from "./attention";
import { doneWorkouts } from "./stats";
import type { DB } from "./types";

export type FeedKind = "workout" | "metrics" | "photo" | "session" | "missed" | "class";

export interface FeedEvent {
  id: string;
  at: Date;
  kind: FeedKind;
  text: string;
  href?: string;
}

/**
 * What a client has been up to, newest first: workouts, body check-ins, photos, sessions (done or missed) and classes attended.
 * Used by the client's Overview and by the chat's side panel.
 */
export function buildFeed(db: Pick<DB, "workouts" | "metrics" | "photos" | "bookings" | "groups">, clientId: string, now: Date, limit = 8): FeedEvent[] {
  const ev: FeedEvent[] = [];
  for (const w of doneWorkouts(db.workouts, clientId).slice(-8)) ev.push({ id: `w${w.id}`, at: parseISO(w.startedAt), kind: "workout", text: `Logged “${w.title || "a workout"}”`, href: `/workout/${w.id}` });
  for (const m of db.metrics.filter((x) => x.clientId === clientId).sort((a, b) => a.date.localeCompare(b.date)).slice(-4)) ev.push({ id: `m${m.id}`, at: parseISO(m.date), kind: "metrics", text: "Updated body metrics" });
  for (const p of db.photos.filter((x) => x.clientId === clientId).sort((a, b) => a.date.localeCompare(b.date)).slice(-3)) ev.push({ id: `p${p.id}`, at: parseISO(p.date), kind: "photo", text: `Added a ${p.pose.toLowerCase()} progress photo` });
  for (const b of db.bookings) {
    if (b.clientId !== clientId) continue;
    if (b.status === "COMPLETED") ev.push({ id: `b${b.id}`, at: parseISO(b.start), kind: "session", text: "Completed a session" });
    else if (b.status === "NO_SHOW") ev.push({ id: `b${b.id}`, at: parseISO(b.start), kind: "missed", text: "Missed a session" });
  }
  for (const g of db.groups) if (attendedClass(g, clientId)) ev.push({ id: `g${g.id}`, at: parseISO(g.start), kind: "class", text: `Attended “${g.title}”`, href: `/classes/${g.id}` });
  return ev
    .filter((e) => e.at.getTime() <= now.getTime())
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}
