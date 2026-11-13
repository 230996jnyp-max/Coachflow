import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { aiUsageLog, gymMembers, users } from "./schema";

/** The four AI features the owner tracks, plus everything else (food estimates, explanations ...). */
export const AI_FEATURES = ["workout_import", "niche_search", "custom_tracking", "progression", "other"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABEL: Record<AiFeature, string> = {
  workout_import: "AI workout imports",
  niche_search: "AI niche and sport searches",
  custom_tracking: "AI custom tracking builder",
  progression: "AI auto-progression and deload suggestions",
  other: "Other AI",
};

/**
 * Records one AI call for the owner's usage tracker: who used it, which coach it belongs to (a client's coach), that coach's gym, and what
 * for. Never throws and never slows the caller down on failure: a missed log line is better than a failed workout import.
 */
export async function logAiUsage(opts: { userId: string; feature: AiFeature; units?: number }): Promise<void> {
  try {
    const d = await db();
    const [u] = await d.select({ id: users.id, role: users.role, coachId: users.coachId }).from(users).where(eq(users.id, opts.userId)).limit(1);
    const coachId = !u ? null : u.role === "CLIENT" ? u.coachId : u.id;
    let gymId: string | null = null;
    if (coachId) {
      const [m] = await d.select({ gymId: gymMembers.gymId }).from(gymMembers).where(eq(gymMembers.userId, coachId)).limit(1);
      gymId = m?.gymId ?? null;
    }
    await d.insert(aiUsageLog).values({ id: `ai_${randomUUID()}`, userId: opts.userId, coachId, gymId, feature: opts.feature, units: Math.max(1, opts.units ?? 1) });
  } catch (e) {
    console.error("logAiUsage failed", e);
  }
}
