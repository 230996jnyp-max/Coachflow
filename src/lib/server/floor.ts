import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { workoutSetCount } from "@/lib/stats";
import { applyAttendance, type MarkInput } from "./attendance";
import type { SessionKind } from "./credits";
import { db } from "./db";
import { notify } from "./groups";
import { notifications, workouts, type UserRow } from "./schema";
import { openWorkout, writableClientIds } from "./training";

/*
 * Gym-floor mode, the closing step: one call settles attendance and credits for everyone in the session, finalises it, and gives
 * each client who trained their recap (an in-app notification; an email only when they set a PR).
 */

export async function endFloorSession(me: UserRow, input: { kind: SessionKind; id: string; marks: MarkInput[]; workoutIds: string[] }): Promise<{ recaps: number }> {
  await applyAttendance(me, { kind: input.kind, id: input.id, marks: input.marks, finalize: true });

  const ids = [...new Set(input.workoutIds)].slice(0, 40);
  if (!ids.length) return { recaps: 0 };
  const d = await db();
  const allowed = new Set(await writableClientIds(me));
  const rows = await d.select().from(workouts).where(inArray(workouts.id, ids));
  let recaps = 0;
  for (const row of rows) {
    if (!allowed.has(row.clientId) || row.status !== "DONE") continue;
    const w = openWorkout(row);
    if (!w) continue;
    const sets = workoutSetCount(w);
    if (!sets) continue;
    // Finishing twice (a retry after a lost connection) must not tell the client twice.
    const kind = `recap_${w.id}`;
    const [dup] = await d.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, row.clientId), eq(notifications.kind, kind))).limit(1);
    if (dup) continue;
    const prs = w.exercises.reduce((n, we) => n + we.sets.filter((s) => s.pr?.length).length, 0);
    await notify(
      [row.clientId],
      kind,
      {
        title: prs ? `${prs === 1 ? "A new PR" : `${prs} new PRs`} in today's session` : "Your session recap",
        body: `Great work today: ${sets} set${sets === 1 ? "" : "s"} logged${prs ? ` and ${prs === 1 ? "a personal record" : `${prs} personal records`}` : ""}. Open your workout to see the recap and share it.`,
        link: `/workout/${w.id}`,
      },
      { email: prs > 0 },
    );
    recaps++;
  }
  return { recaps };
}
