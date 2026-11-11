import "server-only";
import { PAIN_ALERT } from "@/lib/feedback";
import type { Workout } from "@/lib/types";
import { toUser } from "./accounts";
import { notify } from "./groups";
import type { UserRow } from "./schema";

/**
 * When a client finishes a workout reporting pain at or above the alert level, tell their coach (in the app and by email).
 * `before` is the pain already saved with this workout, so saving the same workout again never repeats the alert.
 */
export async function alertOnPain(me: UserRow, w: Workout, before: number | undefined): Promise<void> {
  if (me.role !== "CLIENT" || !me.coachId || w.status !== "DONE" || w.clientId !== me.id) return;
  const pain = w.feedback?.pain;
  if (pain === undefined || pain < PAIN_ALERT) return;
  if (before !== undefined && before >= PAIN_ALERT) return;
  const where = w.feedback?.areas?.length ? ` (${w.feedback.areas.join(", ")})` : "";
  await notify([me.coachId], "pain_report", { title: `Pain reported: ${pain}/10`, body: `${toUser(me).name} reported pain ${pain}/10${where} after \u201c${w.title || "their workout"}\u201d.`, link: `/clients/${me.id}`, about: me.id });
}
