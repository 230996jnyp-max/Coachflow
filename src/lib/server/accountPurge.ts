import "server-only";
import { eq, inArray, like, or } from "drizzle-orm";
import { stripe, stripeReady } from "./billing";
import { db } from "./db";
import { HttpError } from "./http";
import {
  adminActions,
  aiRules,
  aiReviewCredits,
  aiReviews,
  aiTrainerPlans,
  aiTrainerProfiles,
  aiUsageLog,
  aiWaitlist,
  classEvents,
  coachBilling,
  coachPublic,
  coachSignupRequests,
  consultBlocks,
  consultReports,
  consults,
  gymAudit,
  gymBilling,
  gymInvites,
  gymMoves,
  gymOrgs,
  messages,
  paymentOrders,
  paymentPackages,
  paymentSettings,
  pushSubscriptions,
  rateEvents,
  referrals,
  workoutComments,
  type UserRow,
} from "./schema";
import { autopilotEvents, autopilotRules, programEnrolments, programSuggestions, programs, smartReplySettings } from "./schemaFlow";

/*
 * What has to happen, beyond the per-feature cleanups in accountAdmin, when someone's account is erased for good: their paid plans are
 * switched off at Stripe (so nobody is charged after they are gone), and every table that holds something of theirs is emptied.
 * It is used both when people delete their own account and when the owner deletes one.
 */

/** Refuses while money is still moving on a video consult, so a payout or refund is never orphaned. */
export async function assertCanDelete(row: UserRow): Promise<void> {
  if (row.role === "OWNER") throw new HttpError(403, "The platform owner account can't be deleted.");
  const d = await db();
  const mine = await d.select({ status: consults.status, payout: consults.payoutStatus }).from(consults).where(or(eq(consults.soloId, row.id), eq(consults.trainerId, row.id)));
  if (mine.some((c) => c.status === "OPEN" || c.status === "LIVE" || c.payout === "HELD")) {
    throw new HttpError(409, "A video consult is in progress or its payment hasn't been settled yet. Please try again once it has finished (payouts settle a few days after the call).");
  }
}

/** Cancels the coach's and the gyms' CoachFlow subscriptions straight away (no refund, nothing more is charged). Throws if Stripe refuses, so nothing is left billing. */
export async function releaseStripe(row: UserRow): Promise<void> {
  const d = await db();
  const gyms = await d.select({ id: gymOrgs.id }).from(gymOrgs).where(eq(gymOrgs.ownerId, row.id));
  const targets: { sub: string | null; customer: string | null }[] = [];
  const [cb] = await d.select().from(coachBilling).where(eq(coachBilling.coachId, row.id)).limit(1);
  if (cb) targets.push({ sub: cb.stripeSubscriptionId, customer: cb.stripeCustomerId });
  if (gyms.length) for (const g of await d.select().from(gymBilling).where(inArray(gymBilling.gymId, gyms.map((x) => x.id)))) targets.push({ sub: g.stripeSubscriptionId, customer: g.stripeCustomerId });
  if (gyms.length) await d.delete(gymBilling).where(inArray(gymBilling.gymId, gyms.map((x) => x.id)));
  if (!targets.some((t) => t.sub || t.customer)) return;
  if (!stripeReady()) return; // local test mode: nothing to cancel
  const s = stripe();
  for (const t of targets) {
    try {
      if (t.sub) await s.subscriptions.cancel(t.sub);
    } catch (e) {
      // Already cancelled or gone is fine; anything else must stop the deletion rather than leave a live subscription behind.
      const code = (e as { code?: string; statusCode?: number }) ?? {};
      if (code.code !== "resource_missing" && code.statusCode !== 404) throw new HttpError(502, "We couldn't cancel your CoachFlow subscription just now, so nothing was deleted. Please try again in a minute.");
    }
    try {
      if (t.customer) await s.customers.del(t.customer);
    } catch {
      /* the customer record is only a convenience; the subscription is what matters */
    }
  }
}

/** Empties every table that holds something of this person that the per-feature cleanups don't. */
export async function purgeExtras(row: UserRow): Promise<void> {
  const d = await db();
  const id = row.id;
  const mail = (row.email ?? "").toLowerCase();

  // Video consults (both sides), their reports and blocks.
  const mine = await d.select({ id: consults.id }).from(consults).where(or(eq(consults.soloId, id), eq(consults.trainerId, id)));
  const cids = mine.map((c) => c.id);
  if (cids.length) await d.delete(consultReports).where(inArray(consultReports.consultId, cids));
  await d.delete(consultReports).where(eq(consultReports.reporterId, id));
  if (cids.length) await d.delete(consults).where(inArray(consults.id, cids));
  await d.delete(consultBlocks).where(eq(consultBlocks.userId, id));
  await d.delete(coachPublic).where(eq(coachPublic.coachId, id));

  await d.delete(referrals).where(or(eq(referrals.referrerId, id), eq(referrals.refereeId, id)));
  await d.delete(coachBilling).where(eq(coachBilling.coachId, id));
  await d.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, id));
  await d.delete(aiTrainerPlans).where(eq(aiTrainerPlans.userId, id));
  await d.delete(aiTrainerProfiles).where(eq(aiTrainerProfiles.userId, id));
  await d.delete(aiUsageLog).where(or(eq(aiUsageLog.userId, id), eq(aiUsageLog.coachId, id)));
  await d.delete(aiReviewCredits).where(eq(aiReviewCredits.coachId, id));
  await d.delete(aiReviews).where(eq(aiReviews.coachId, id));
  await d.delete(aiRules).where(eq(aiRules.coachId, id));
  await d.delete(classEvents).where(eq(classEvents.coachId, id));

  await d.delete(paymentOrders).where(or(eq(paymentOrders.coachId, id), eq(paymentOrders.clientId, id)));
  await d.delete(paymentPackages).where(eq(paymentPackages.coachId, id));
  await d.delete(paymentSettings).where(eq(paymentSettings.coachId, id));

  await d.delete(programSuggestions).where(or(eq(programSuggestions.ownerId, id), eq(programSuggestions.clientId, id)));
  await d.delete(programEnrolments).where(or(eq(programEnrolments.ownerId, id), eq(programEnrolments.clientId, id)));
  await d.delete(programs).where(eq(programs.ownerId, id));
  await d.delete(autopilotEvents).where(or(eq(autopilotEvents.ownerId, id), eq(autopilotEvents.clientId, id)));
  await d.delete(autopilotRules).where(eq(autopilotRules.ownerId, id));
  await d.delete(smartReplySettings).where(eq(smartReplySettings.ownerId, id));

  await d.delete(messages).where(eq(messages.fromId, id));
  await d.delete(workoutComments).where(or(eq(workoutComments.authorId, id), eq(workoutComments.clientId, id)));
  await d.delete(gymAudit).where(eq(gymAudit.actorId, id));
  await d.delete(gymMoves).where(or(eq(gymMoves.clientId, id), eq(gymMoves.fromCoachId, id), eq(gymMoves.toCoachId, id)));
  if (mail) {
    await d.delete(gymInvites).where(eq(gymInvites.email, mail));
    await d.delete(aiWaitlist).where(eq(aiWaitlist.email, mail));
    await d.delete(coachSignupRequests).where(eq(coachSignupRequests.email, mail));
  }
  // Counters kept against their id (wrong-password limits and the like).
  await d.delete(rateEvents).where(like(rateEvents.key, `%${id}%`));
  // The owner's activity log keeps that something was done, but no longer names the person.
  await d.update(adminActions).set({ targetLabel: "(deleted account)" }).where(eq(adminActions.targetId, id));
}
