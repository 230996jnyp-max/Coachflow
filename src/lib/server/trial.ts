import "server-only";
import { trialOver } from "@/lib/signupRules";
import type { UserRow } from "./schema";

/** Trial enforcement is off until payments are live: set TRIAL_ENFORCED=1 to lock out a self sign-up whose free month is over. */
export const trialEnforced = (): boolean => process.env.TRIAL_ENFORCED === "1";

/** True when this person's free month is over and enforcement is on. The owner, coach-made clients and older accounts have no trial and are never blocked. */
export const trialBlocked = (row: Pick<UserRow, "role" | "trialEndsAt">): boolean => trialEnforced() && row.role !== "OWNER" && trialOver(row.trialEndsAt);
