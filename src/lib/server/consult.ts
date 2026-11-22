import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull, lt, ne, or } from "drizzle-orm";
import type Stripe from "stripe";
import {
  ACCEPT_WINDOW_MIN,
  CONSULT_MINUTES,
  CONSULT_PRICE_CENTS,
  CONSULT_TRAINER_CENTS,
  isReason,
  PAYOUT_DELAY_HOURS,
  reasonLabel,
  recommend,
  money,
  trainerShare,
  cleanStars,
  type ConsultFacts,
  type ConsultStatus,
  type Recommendation,
  type RefundChoice,
  type ReporterRole,
  type Sanction,
} from "@/lib/consults";
import { SUPPORT_EMAIL } from "@/lib/support";
import { isMinorRow, isPersonalRow, openProfile, usersByIds } from "./accounts";
import { consultBrief, type ConsultBrief } from "./aiTrainer";
import { stripe, stripeReady } from "./billing";
import { trainerCard } from "./coachPublic";
import { decryptJson, encryptJson } from "./crypto";
import { createRoom, dailyReady, deleteRoom, meetingToken } from "./daily";
import { db, isLocalTestMode } from "./db";
import { notify } from "./groups";
import { badRequest, conflict, forbidden, HttpError, notFound } from "./http";
import { escapeHtml, layout, sendMail } from "./mail";
import { paymentState, paymentsReady } from "./payments";
import { hit } from "./rateLimit";
import { coachPublic, consultBlocks, consultReports, consults, paymentSettings, users, type ConsultReportRow, type ConsultRow, type UserRow } from "./schema";
import { recentDoneWorkouts } from "./training";

/*
 * Consult a trainer (rules and prices in lib/consults.ts). Someone training on their own pays S$50 at Stripe Checkout on the CoachFlow
 * account; the card is only held. Every trainer who takes consults is told, and the first to accept takes it: the hold is captured, a
 * private video room that closes itself after the hour is made, and the hour starts. With no trainer in 30 minutes the hold is released.
 * The trainer's S$35 goes to their connected Stripe account 48 hours after the consult unless a report holds it; the owner decides
 * reports (refund, warning, suspension). CoachFlow pays the card fee out of its S$15.
 */

const MIN = 60_000;
const aadC = (id: string) => `consult:${id}`;
const aadR = (id: string) => `consult-report:${id}`;
const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

interface Secret {
  question: string;
  shareHealth: boolean;
}

/** Consults can run: the platform's Stripe key and the video service are set up (or their stand-ins in local tests). */
export const consultsReady = (): boolean => stripeReady() && dailyReady() && (paymentsReady() || (!!process.env.PAYMENTS_FAKE_STRIPE && isLocalTestMode()));

function secretOf(c: ConsultRow): Secret {
  try {
    return decryptJson<Secret>(c.dataEnc, aadC(c.id));
  } catch {
    return { question: "", shareHealth: false };
  }
}

const nameOf = (u: UserRow | undefined): string => {
  if (!u) return "Someone";
  try {
    return (u.role === "CLIENT" ? openProfile(u).name : (u.name ?? u.username)).trim() || "Someone";
  } catch {
    return "Someone";
  }
};
const firstOf = (u: UserRow | undefined) => nameOf(u).split(/\s+/)[0];

async function get(id: string): Promise<ConsultRow | null> {
  if (typeof id !== "string" || !/^cs_[a-f0-9]{20}$/.test(id)) return null;
  const d = await db();
  const [c] = await d.select().from(consults).where(eq(consults.id, id)).limit(1);
  return c ?? null;
}

async function isBlocked(userId: string): Promise<boolean> {
  const d = await db();
  const [b] = await d.select().from(consultBlocks).where(eq(consultBlocks.userId, userId)).limit(1);
  return !!b;
}

const roleIn = (c: ConsultRow, me: UserRow): ReporterRole | null => (c.soloId === me.id ? "SOLO" : c.trainerId === me.id ? "TRAINER" : null);

/* ---------------- Who may take consults ---------------- */
/** Trainers who switched consults on, still have a working Stripe account, aren't suspended and aren't in a consult right now. */
async function availableTrainers(): Promise<string[]> {
  const d = await db();
  const rows = await d
    .select({ id: users.id })
    .from(coachPublic)
    .innerJoin(users, eq(users.id, coachPublic.coachId))
    .innerJoin(paymentSettings, eq(paymentSettings.coachId, coachPublic.coachId))
    .where(and(eq(coachPublic.takesConsults, true), eq(users.active, true), isNotNull(paymentSettings.stripeAccountId), eq(paymentSettings.chargesEnabled, true)));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const blocked = new Set((await d.select({ id: consultBlocks.userId }).from(consultBlocks).where(inArray(consultBlocks.userId, ids))).map((b) => b.id));
  const busy = new Set((await d.select({ id: consults.trainerId }).from(consults).where(and(eq(consults.status, "LIVE"), inArray(consults.trainerId, ids)))).map((b) => b.id));
  return ids.filter((id) => !blocked.has(id) && !busy.has(id));
}

async function mayTakeConsults(trainer: UserRow): Promise<void> {
  if (trainer.role !== "COACH" && trainer.role !== "OWNER") throw forbidden("Only trainers can take consults.");
  const d = await db();
  const [p] = await d.select().from(coachPublic).where(eq(coachPublic.coachId, trainer.id)).limit(1);
  if (!p?.takesConsults) throw badRequest("Switch on 'Take consults' first (Settings, Profile).");
  if (await isBlocked(trainer.id)) throw forbidden("You can't take consults at the moment. Contact CoachFlow support.");
  const pay = await paymentState(trainer).catch(() => null);
  if (!pay?.stripeReady) throw badRequest("Your Stripe account needs to be connected to take consults (Settings, Payments).");
}

/* ---------------- Asking for a consult ---------------- */
export async function startConsult(solo: UserRow, body: Record<string, unknown>, origin: string): Promise<{ id: string; url: string }> {
  if (!isPersonalRow(solo)) throw forbidden("Consults are for people training on their own.");
  if (isMinorRow(solo)) throw forbidden("Consults aren't available under 18.");
  if (!consultsReady()) throw new HttpError(503, "Consults aren't available yet. Please try again later.");
  if (await isBlocked(solo.id)) throw forbidden("You can't book consults at the moment. Contact CoachFlow support if you think this is a mistake.");
  await sweep();
  const d = await db();
  const [active] = await d.select().from(consults).where(and(eq(consults.soloId, solo.id), inArray(consults.status, ["OPEN", "LIVE"]))).limit(1);
  if (active) throw conflict("You already have a consult under way.");
  await hit(`consult:${solo.id}`, 6, 86_400_000, "That's a lot of consult requests today. Please try again tomorrow.");
  const question = typeof body.question === "string" ? body.question.replace(/\s+\n/g, "\n").trim().slice(0, 1000) : "";
  const shareHealth = body.shareHealth === true;
  // A checkout left unfinished earlier is dropped (its Stripe page expires by itself).
  await d.update(consults).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(consults.soloId, solo.id), eq(consults.status, "PAYING")));
  const id = newId("cs");
  await d.insert(consults).values({ id, soloId: solo.id, status: "PAYING", priceCents: CONSULT_PRICE_CENTS, trainerCents: CONSULT_TRAINER_CENTS, dataEnc: encryptJson({ question, shareHealth } satisfies Secret, aadC(id)) });
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: "sgd", unit_amount: CONSULT_PRICE_CENTS, product_data: { name: "Consult with a CoachFlow trainer", description: "One hour on a video call. Your card is only charged once a trainer accepts." } } }],
      payment_intent_data: { capture_method: "manual", metadata: { consultId: id, kind: "consult" }, transfer_group: id, description: "CoachFlow consult (1 hour)" },
      metadata: { consultId: id, kind: "consult" },
      ...(solo.email ? { customer_email: solo.email } : {}),
      success_url: `${origin}/consult?id=${id}&paid=1`,
      cancel_url: `${origin}/consult?id=${id}&cancelled=1`,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    },
    { idempotencyKey: `consult_checkout_${id}` },
  );
  if (!session.url) throw new HttpError(502, "Stripe didn't return a checkout page. Please try again.");
  await d.update(consults).set({ checkoutSessionId: session.id, updatedAt: new Date() }).where(eq(consults.id, id));
  return { id, url: session.url };
}

/** The card hold is in place: the request goes to every trainer who is free. Runs once (the status change is guarded). */
async function markOpen(id: string, paymentIntentId: string | null): Promise<boolean> {
  const d = await db();
  const now = new Date();
  const changed = await d
    .update(consults)
    .set({ status: "OPEN", paymentIntentId, acceptBy: new Date(now.getTime() + ACCEPT_WINDOW_MIN * MIN), updatedAt: now })
    .where(and(eq(consults.id, id), eq(consults.status, "PAYING")))
    .returning({ id: consults.id, dataEnc: consults.dataEnc });
  if (!changed.length) return false;
  const q = secretOf({ id, dataEnc: changed[0].dataEnc } as ConsultRow).question;
  const trainers = await availableTrainers();
  await notify(trainers, "consult_request", { title: `A consult is waiting (${money(CONSULT_TRAINER_CENTS)} for you)`, body: `Someone training on their own wants a 1-hour video call${q ? `: "${q.slice(0, 90)}${q.length > 90 ? "…" : ""}"` : "."} The first trainer to accept takes it.`, link: "/consult" }, { email: false });
  return true;
}

const idOf = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as { id: string }).id) : null);

/** Stripe events for consults (they carry metadata.kind = "consult"). Returns null for anything else. */
export async function handleConsultEvent(event: Stripe.Event): Promise<boolean | null> {
  const obj = event.data.object as unknown as { metadata?: Record<string, string> | null; payment_intent?: unknown; status?: string };
  if (obj.metadata?.kind !== "consult" || !obj.metadata.consultId) return null;
  const id = obj.metadata.consultId;
  if (event.type === "checkout.session.completed") {
    if (obj.status === "complete") await markOpen(id, idOf(obj.payment_intent));
    return true;
  }
  if (event.type === "checkout.session.expired") {
    const d = await db();
    await d.update(consults).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(consults.id, id), eq(consults.status, "PAYING")));
    return true;
  }
  return false;
}

/** Back from Stripe before the webhook arrived: asks Stripe directly. */
async function syncPaying(c: ConsultRow): Promise<void> {
  if (c.status !== "PAYING" || !c.checkoutSessionId) return;
  try {
    const s = await stripe().checkout.sessions.retrieve(c.checkoutSessionId);
    if (s.status === "complete") await markOpen(c.id, idOf(s.payment_intent));
    else if (s.status === "expired") {
      const d = await db();
      await d.update(consults).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(consults.id, c.id), eq(consults.status, "PAYING")));
    }
  } catch {
    /* the webhook will do it */
  }
}

/* ---------------- Time passing: expiry, the end of the hour, payouts ---------------- */
let lastSweep = 0;

/** Moves consults on: nobody accepted in time (release the hold), the hour is over, the trainer's share is due. Cheap; run often. */
export async function sweep(force = false, now = new Date()): Promise<{ expired: number; finished: number; paid: number }> {
  const out = { expired: 0, finished: 0, paid: 0 };
  if (!force && Date.now() - lastSweep < 15_000) return out;
  lastSweep = Date.now();
  const d = await db();
  // Nobody accepted: the hold is released and the person is told.
  const late = await d.select().from(consults).where(and(eq(consults.status, "OPEN"), lt(consults.acceptBy, now)));
  for (const c of late) {
    const moved = await d.update(consults).set({ status: "EXPIRED", updatedAt: now }).where(and(eq(consults.id, c.id), eq(consults.status, "OPEN"))).returning({ id: consults.id });
    if (!moved.length) continue;
    if (c.paymentIntentId) await stripe().paymentIntents.cancel(c.paymentIntentId, {}, { idempotencyKey: `consult_release_${c.id}` }).catch(() => undefined);
    await notify([c.soloId], "consult_expired", { title: "No trainer was free this time", body: `Nobody could take your consult within ${ACCEPT_WINDOW_MIN} minutes, so the ${money(c.priceCents)} hold on your card has been released. You weren't charged. Please try again another time.`, link: "/consult" });
    out.expired++;
  }
  // Checkouts never finished.
  await d.update(consults).set({ status: "CANCELLED", updatedAt: now }).where(and(eq(consults.status, "PAYING"), lt(consults.createdAt, new Date(now.getTime() - 40 * MIN))));
  // The hour is over.
  const over = await d.select().from(consults).where(and(eq(consults.status, "LIVE"), lt(consults.endsAt, now)));
  for (const c of over) {
    const moved = await d.update(consults).set({ status: "DONE", endedAt: c.endsAt, updatedAt: now }).where(and(eq(consults.id, c.id), eq(consults.status, "LIVE"))).returning({ id: consults.id });
    if (moved.length) out.finished++;
  }
  // The trainer's share, once due and with no open report.
  const due = await d.select().from(consults).where(and(eq(consults.status, "DONE"), eq(consults.payoutStatus, "HELD"), lt(consults.payoutDueAt, now)));
  for (const c of due) if (await payTrainer(c)) out.paid++;
  return out;
}

async function openReports(consultId: string): Promise<ConsultReportRow[]> {
  const d = await db();
  return d.select().from(consultReports).where(and(eq(consultReports.consultId, consultId), eq(consultReports.status, "OPEN")));
}

/** Sends the trainer's share to their connected Stripe account. Leaves it held (and tries again later) when anything is missing. */
async function payTrainer(c: ConsultRow): Promise<boolean> {
  if (c.payoutStatus !== "HELD" || !c.trainerId) return false;
  if ((await openReports(c.id)).length) return false;
  const d = await db();
  if (c.trainerCents <= 0) {
    await d.update(consults).set({ payoutStatus: "CANCELLED", updatedAt: new Date() }).where(and(eq(consults.id, c.id), eq(consults.payoutStatus, "HELD")));
    return false;
  }
  const [st] = await d.select().from(paymentSettings).where(eq(paymentSettings.coachId, c.trainerId)).limit(1);
  if (!st?.stripeAccountId) return false;
  try {
    let charge: string | undefined;
    if (c.paymentIntentId) {
      const pi = await stripe().paymentIntents.retrieve(c.paymentIntentId);
      charge = idOf(pi.latest_charge) ?? undefined;
    }
    const t = await stripe().transfers.create(
      { amount: c.trainerCents, currency: "sgd", destination: st.stripeAccountId, transfer_group: c.id, ...(charge ? { source_transaction: charge } : {}), metadata: { consultId: c.id } },
      { idempotencyKey: `consult_payout_${c.id}_${c.trainerCents}` },
    );
    const moved = await d.update(consults).set({ payoutStatus: "PAID", transferId: t.id, updatedAt: new Date() }).where(and(eq(consults.id, c.id), eq(consults.payoutStatus, "HELD"))).returning({ id: consults.id });
    if (moved.length) await notify([c.trainerId], "consult_paid", { title: `${money(c.trainerCents)} is on its way`, body: `Your ${money(c.trainerCents)} share of a consult was sent to your Stripe account.`, link: "/consult" }, { email: false });
    return moved.length > 0;
  } catch (e) {
    console.error("consult payout failed", c.id, e instanceof Error ? e.message : e);
    return false;
  }
}

/* ---------------- The trainer accepts, then both join ---------------- */
export async function acceptConsult(trainer: UserRow, id: string): Promise<ConsultView> {
  await mayTakeConsults(trainer);
  await sweep(true);
  const d = await db();
  const [busy] = await d.select({ id: consults.id }).from(consults).where(and(eq(consults.trainerId, trainer.id), eq(consults.status, "LIVE"))).limit(1);
  if (busy) throw conflict("Finish your current consult first.");
  const c0 = await get(id);
  if (!c0) throw notFound("That consult wasn't found.");
  if (c0.soloId === trainer.id) throw forbidden();
  const now = new Date();
  const endsAt = new Date(now.getTime() + CONSULT_MINUTES * MIN);
  // First to accept wins: only one of two trainers tapping at once gets past this.
  const won = await d
    .update(consults)
    .set({ status: "LIVE", trainerId: trainer.id, acceptedAt: now, endsAt, payoutStatus: "HELD", payoutDueAt: new Date(endsAt.getTime() + PAYOUT_DELAY_HOURS * 60 * MIN), updatedAt: now })
    .where(and(eq(consults.id, id), eq(consults.status, "OPEN")))
    .returning();
  if (!won.length) throw conflict(c0.status === "LIVE" || c0.status === "DONE" ? "Another trainer has already taken this consult." : "This consult is no longer waiting.");
  const c = won[0];
  try {
    if (!c.paymentIntentId) throw new Error("no payment");
    await stripe().paymentIntents.capture(c.paymentIntentId, {}, { idempotencyKey: `consult_capture_${c.id}` });
  } catch (e) {
    console.error("consult capture failed", c.id, e instanceof Error ? e.message : e);
    await d.update(consults).set({ status: "CANCELLED", payoutStatus: "CANCELLED", updatedAt: new Date() }).where(eq(consults.id, c.id));
    await notify([c.soloId], "consult_failed", { title: "Your consult couldn't start", body: "The payment on your card didn't go through, so the consult was cancelled and you weren't charged. Please try again.", link: "/consult" });
    throw conflict("The person's payment didn't go through, so this consult was cancelled. You don't need to do anything.");
  }
  await ensureRoom(c);
  await notify([c.soloId], "consult_accepted", { title: `${firstOf(trainer)} is ready for your consult`, body: `Your hour has started. Join the video call now (it closes at ${endsAt.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" })}).`, link: `/consult?id=${c.id}` });
  return viewFor(trainer, (await get(c.id))!);
}

async function ensureRoom(c: ConsultRow): Promise<ConsultRow> {
  if (c.roomUrl || !c.endsAt) return c;
  try {
    const room = await createRoom(`cf-${c.id.replace(/_/g, "-")}`, c.endsAt);
    const d = await db();
    const [u] = await d.update(consults).set({ roomName: room.name, roomUrl: room.url, updatedAt: new Date() }).where(eq(consults.id, c.id)).returning();
    return u ?? c;
  } catch (e) {
    console.error("consult room failed", c.id, e instanceof Error ? e.message : e);
    return c;
  }
}

/** The address that puts this person into the call (with their own token, valid until the hour ends). */
export async function joinConsult(me: UserRow, id: string): Promise<{ url: string; endsAt: string }> {
  await sweep();
  let c = await get(id);
  if (!c) throw notFound("That consult wasn't found.");
  const role = roleIn(c, me);
  if (!role) throw forbidden();
  if (c.status !== "LIVE" || !c.endsAt || c.endsAt <= new Date()) throw badRequest("This consult isn't running.");
  const endsAt = c.endsAt;
  c = await ensureRoom(c);
  if (!c.roomUrl || !c.roomName) throw new HttpError(502, "The video room couldn't be opened. Please try again in a moment.");
  const token = await meetingToken(c.roomName, role === "TRAINER" ? `${firstOf(me)} (trainer)` : firstOf(me), role === "TRAINER", endsAt);
  const d = await db();
  if (role === "SOLO" && !c.soloJoinedAt) await d.update(consults).set({ soloJoinedAt: new Date() }).where(eq(consults.id, c.id));
  if (role === "TRAINER" && !c.trainerJoinedAt) await d.update(consults).set({ trainerJoinedAt: new Date() }).where(eq(consults.id, c.id));
  return { url: `${c.roomUrl}?t=${encodeURIComponent(token)}`, endsAt: endsAt.toISOString() };
}

/** Either of them ends the consult before the hour is up. */
export async function endConsult(me: UserRow, id: string): Promise<ConsultView> {
  const c = await get(id);
  if (!c) throw notFound("That consult wasn't found.");
  const role = roleIn(c, me);
  if (!role) throw forbidden();
  if (c.status !== "LIVE") return viewFor(me, c);
  const now = new Date();
  const d = await db();
  await d.update(consults).set({ status: "DONE", endedAt: now, endedBy: role, payoutDueAt: new Date(now.getTime() + PAYOUT_DELAY_HOURS * 60 * MIN), updatedAt: now }).where(and(eq(consults.id, c.id), eq(consults.status, "LIVE")));
  if (c.roomName) await deleteRoom(c.roomName);
  const other = role === "SOLO" ? c.trainerId : c.soloId;
  if (other) await notify([other], "consult_ended", { title: "The consult has ended", body: `${firstOf(me)} ended the call.`, link: `/consult?id=${c.id}` }, { email: false });
  return viewFor(me, (await get(c.id))!);
}

/** The person cancels before a trainer accepted: nothing is charged. */
export async function cancelConsult(me: UserRow, id: string): Promise<ConsultView> {
  const c = await get(id);
  if (!c || c.soloId !== me.id) throw notFound("That consult wasn't found.");
  if (c.status !== "PAYING" && c.status !== "OPEN") throw badRequest(c.status === "LIVE" ? "A trainer has already accepted. You can end the call or report a problem instead." : "This consult can't be cancelled.");
  const d = await db();
  const moved = await d.update(consults).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(consults.id, c.id), inArray(consults.status, ["PAYING", "OPEN"]))).returning({ id: consults.id });
  if (moved.length && c.paymentIntentId) await stripe().paymentIntents.cancel(c.paymentIntentId, {}, { idempotencyKey: `consult_release_${c.id}` }).catch(() => undefined);
  if (moved.length && c.status === "PAYING" && c.checkoutSessionId) await stripe().checkout.sessions.expire(c.checkoutSessionId).catch(() => undefined);
  return viewFor(me, (await get(c.id))!);
}

/** One rating per consult, after it ended, by the person. Shown on the trainer's public page (first name only). */
export async function rateConsult(me: UserRow, id: string, body: Record<string, unknown>): Promise<ConsultView> {
  const c = await get(id);
  if (!c || c.soloId !== me.id) throw notFound("That consult wasn't found.");
  if (c.status !== "DONE" || !c.trainerId) throw badRequest("You can rate a consult once it has ended.");
  if (c.reviewedAt) throw conflict("You've already rated this consult.");
  const stars = cleanStars(body.stars);
  if (!stars) throw badRequest("Choose 1 to 5 stars.");
  const review = typeof body.review === "string" ? body.review.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 500) : "";
  const d = await db();
  await d.update(consults).set({ stars, review: review || null, reviewedAt: new Date(), updatedAt: new Date() }).where(and(eq(consults.id, c.id), eq(consults.soloId, me.id)));
  return viewFor(me, (await get(c.id))!);
}

/* ---------------- Reports ---------------- */
export async function reportConsult(me: UserRow, id: string, body: Record<string, unknown>): Promise<ConsultView> {
  const c = await get(id);
  if (!c) throw notFound("That consult wasn't found.");
  const role = roleIn(c, me);
  if (!role) throw forbidden();
  if (c.status !== "LIVE" && c.status !== "DONE") throw badRequest("Only a consult that started can be reported.");
  if (c.payoutStatus === "PAID") throw badRequest(`This consult has already been settled. Please email ${SUPPORT_EMAIL} and we'll look into it.`);
  if (!isReason(role, body.reason)) throw badRequest("Choose what went wrong.");
  const details = typeof body.details === "string" ? body.details.trim().slice(0, 2000) : "";
  if (body.reason === "other" && details.length < 5) throw badRequest("Tell us a little about what happened.");
  const d = await db();
  const [already] = await d.select({ id: consultReports.id }).from(consultReports).where(and(eq(consultReports.consultId, c.id), eq(consultReports.reporterId, me.id), eq(consultReports.status, "OPEN"))).limit(1);
  if (already) throw conflict("You've already reported this consult. We'll be in touch.");
  await hit(`consult-report:${me.id}`, 5, 86_400_000, "That's a lot of reports today. Please email support instead.");
  const rid = newId("cr");
  await d.insert(consultReports).values({ id: rid, consultId: c.id, reporterId: me.id, reporterRole: role, reason: String(body.reason), detailsEnc: encryptJson({ details }, aadR(rid)) });
  const [trainer, solo] = await usersByIds([c.trainerId ?? "", c.soloId]).then((rows) => [rows.find((r) => r.id === c.trainerId), rows.find((r) => r.id === c.soloId)]);
  const what = `${role === "SOLO" ? `${nameOf(solo)} (the client)` : `${nameOf(trainer)} (the trainer)`} reported a consult: ${reasonLabel(role, String(body.reason))}.`;
  const owners = await d.select({ id: users.id }).from(users).where(eq(users.role, "OWNER"));
  await notify(owners.map((o) => o.id), "consult_report", { title: "A consult was reported", body: `${what}${details ? ` "${details.slice(0, 160)}"` : ""}`, link: "/admin?tab=consults" }, { email: false });
  const lines = [what, `Trainer: ${nameOf(trainer)}. Client: ${nameOf(solo)}.`, details ? `Details: ${details}` : "", "The trainer's payout is on hold until you decide (Admin, Consults)."].filter(Boolean);
  await sendMail({ to: SUPPORT_EMAIL, subject: "CoachFlow consult report", text: lines.join("\n"), html: layout("A consult was reported", lines.map((l) => `<p style="margin:0 0 10px;color:#E8ECF4;">${escapeHtml(l)}</p>`).join("")) }).catch(() => undefined);
  return viewFor(me, c);
}

/* ---------------- What each side sees ---------------- */
export interface ConsultView {
  id: string;
  status: ConsultStatus;
  myRole: ReporterRole;
  priceCents: number;
  question: string;
  shareHealth: boolean;
  createdAt: string;
  acceptBy: string | null;
  acceptedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  refundedCents: number;
  trainer: Awaited<ReturnType<typeof trainerCard>>;
  /** For the trainer: the person's first name and what the AI trainer knows (health only if shared). */
  person: { firstName: string; brief: ConsultBrief; recent: { title: string; date: string; exercises: number }[] } | null;
  /** For the trainer: their share and when it is paid. */
  payout: { status: string; cents: number; dueAt: string | null } | null;
  stars: number | null;
  review: string | null;
  canRate: boolean;
  canReport: boolean;
  reported: boolean;
}

export async function viewFor(me: UserRow, c: ConsultRow): Promise<ConsultView> {
  const role = roleIn(c, me);
  if (!role) throw forbidden();
  const s = secretOf(c);
  const d = await db();
  const [mine] = await d.select({ id: consultReports.id }).from(consultReports).where(and(eq(consultReports.consultId, c.id), eq(consultReports.reporterId, me.id))).limit(1);
  let person: ConsultView["person"] = null;
  if (role === "TRAINER" && (c.status === "LIVE" || c.status === "DONE")) {
    const [solo] = await usersByIds([c.soloId]);
    const recent = (await recentDoneWorkouts(c.soloId, 5)).map((w) => ({ title: w.title, date: w.startedAt, exercises: w.exercises.length }));
    person = { firstName: firstOf(solo), brief: await consultBrief(c.soloId, s.shareHealth), recent };
  }
  return {
    id: c.id,
    status: c.status as ConsultStatus,
    myRole: role,
    priceCents: c.priceCents,
    question: s.question,
    shareHealth: s.shareHealth,
    createdAt: c.createdAt.toISOString(),
    acceptBy: c.acceptBy?.toISOString() ?? null,
    acceptedAt: c.acceptedAt?.toISOString() ?? null,
    endsAt: c.endsAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    endedBy: c.endedBy,
    refundedCents: role === "SOLO" ? c.refundedCents : 0,
    trainer: c.trainerId ? await trainerCard(c.trainerId) : null,
    person,
    payout: role === "TRAINER" ? { status: c.payoutStatus, cents: c.trainerCents, dueAt: c.payoutDueAt?.toISOString() ?? null } : null,
    stars: c.stars,
    review: role === "SOLO" ? c.review : null,
    canRate: role === "SOLO" && c.status === "DONE" && !c.reviewedAt && !!c.trainerId,
    canReport: (c.status === "LIVE" || c.status === "DONE") && c.payoutStatus !== "PAID" && !mine,
    reported: !!mine,
  };
}

export async function consultFor(me: UserRow, id: string): Promise<ConsultView> {
  await sweep();
  const c = await get(id);
  if (!c || !roleIn(c, me)) throw notFound("That consult wasn't found.");
  if (c.status === "PAYING") await syncPaying(c);
  return viewFor(me, (await get(id))!);
}

/** The person's page: whether consults can be booked, and their consults (newest first). */
export async function soloBoard(solo: UserRow): Promise<{ available: boolean; reason: string | null; priceCents: number; minutes: number; consults: ConsultView[] }> {
  if (!isPersonalRow(solo)) throw forbidden("Consults are for people training on their own.");
  await sweep();
  const d = await db();
  const rows = await d.select().from(consults).where(and(eq(consults.soloId, solo.id), ne(consults.status, "PAYING"))).orderBy(desc(consults.createdAt)).limit(20);
  const reason = isMinorRow(solo) ? "Consults aren't available under 18." : (await isBlocked(solo.id)) ? "You can't book consults at the moment. Contact CoachFlow support." : !consultsReady() ? "Consults are coming soon." : null;
  return { available: !reason, reason, priceCents: CONSULT_PRICE_CENTS, minutes: CONSULT_MINUTES, consults: await Promise.all(rows.map((r) => viewFor(solo, r))) };
}

/** The trainer's page: requests waiting (first to accept takes them), the consult they are in, and their past consults and earnings. */
export async function trainerBoard(trainer: UserRow): Promise<{
  enabled: boolean;
  stripeReady: boolean;
  suspended: boolean;
  waiting: { id: string; question: string; waitingMin: number; acceptBy: string }[];
  live: ConsultView | null;
  history: ConsultView[];
  earnings: { paidCents: number; heldCents: number; count: number };
}> {
  if (trainer.role !== "COACH" && trainer.role !== "OWNER") throw forbidden();
  await sweep();
  const d = await db();
  const [p] = await d.select().from(coachPublic).where(eq(coachPublic.coachId, trainer.id)).limit(1);
  const suspended = await isBlocked(trainer.id);
  const pay = await paymentState(trainer).catch(() => null);
  const enabled = !!p?.takesConsults && !suspended;
  const now = Date.now();
  const open = enabled ? await d.select().from(consults).where(eq(consults.status, "OPEN")).orderBy(consults.acceptBy) : [];
  const mine = await d.select().from(consults).where(eq(consults.trainerId, trainer.id)).orderBy(desc(consults.acceptedAt)).limit(30);
  const liveRow = mine.find((c) => c.status === "LIVE");
  const done = mine.filter((c) => c.status === "DONE");
  return {
    enabled,
    stripeReady: !!pay?.stripeReady,
    suspended,
    waiting: open.filter((c) => c.soloId !== trainer.id).map((c) => ({ id: c.id, question: secretOf(c).question.slice(0, 400), waitingMin: Math.max(0, Math.round((now - c.updatedAt.getTime()) / MIN)), acceptBy: (c.acceptBy ?? new Date()).toISOString() })),
    live: liveRow ? await viewFor(trainer, liveRow) : null,
    history: await Promise.all(done.slice(0, 20).map((c) => viewFor(trainer, c))),
    earnings: { paidCents: done.filter((c) => c.payoutStatus === "PAID").reduce((a, c) => a + c.trainerCents, 0), heldCents: done.filter((c) => c.payoutStatus === "HELD").reduce((a, c) => a + c.trainerCents, 0), count: done.length },
  };
}

/* ---------------- The owner: reports and decisions ---------------- */
async function factsFor(c: ConsultRow): Promise<ConsultFacts> {
  const d = await db();
  const end = c.endedAt ?? (c.endsAt && c.endsAt < new Date() ? c.endsAt : new Date());
  const minutes = c.acceptedAt ? Math.max(0, Math.min(CONSULT_MINUTES, Math.round((end.getTime() - c.acceptedAt.getTime()) / MIN))) : 0;
  const upheldAgainst = async (userId: string | null, role: ReporterRole) => {
    if (!userId) return 0;
    const theirs = await d.select({ id: consults.id }).from(consults).where(role === "SOLO" ? eq(consults.trainerId, userId) : eq(consults.soloId, userId));
    if (!theirs.length) return 0;
    const rows = await d
      .select({ id: consultReports.id })
      .from(consultReports)
      .where(and(inArray(consultReports.consultId, theirs.map((t) => t.id)), eq(consultReports.upheld, true), eq(consultReports.reporterRole, role), ne(consultReports.consultId, c.id)));
    return rows.length;
  };
  return {
    trainerJoined: !!c.trainerJoinedAt,
    personJoined: !!c.soloJoinedAt,
    minutes,
    endedBy: c.endedBy === "SOLO" || c.endedBy === "TRAINER" ? c.endedBy : null,
    trainerUpheld: await upheldAgainst(c.trainerId, "SOLO"),
    personUpheld: await upheldAgainst(c.soloId, "TRAINER"),
  };
}

export interface AdminReport {
  id: string;
  consultId: string;
  reporterRole: ReporterRole;
  reporterName: string;
  reason: string;
  reasonLabel: string;
  details: string;
  createdAt: string;
  status: string;
  resolution: { refund: RefundChoice; refundCents: number; sanction: Sanction; note: string } | null;
  trainer: { id: string; name: string } | null;
  person: { id: string; name: string };
  consult: { status: string; priceCents: number; refundedCents: number; trainerCents: number; payoutStatus: string; acceptedAt: string | null; endedAt: string | null; endedBy: string | null; question: string };
  facts: ConsultFacts;
  recommendation: Recommendation;
}

export async function adminConsults(): Promise<{
  reports: AdminReport[];
  recent: { id: string; status: string; createdAt: string; person: string; trainer: string | null; priceCents: number; refundedCents: number; trainerCents: number; payoutStatus: string; stars: number | null; reported: boolean }[];
  totals: { done: number; grossCents: number; refundedCents: number; trainerCents: number; keptCents: number };
  blocked: { userId: string; name: string; role: string; reason: string; since: string }[];
  ready: boolean;
}> {
  await sweep(true);
  const d = await db();
  // Every open report, and the decided ones from the last 30 days.
  const reps = await d.select().from(consultReports).where(or(eq(consultReports.status, "OPEN"), gt(consultReports.createdAt, new Date(Date.now() - 30 * 24 * 60 * MIN)))).orderBy(desc(consultReports.createdAt)).limit(60);
  const cIds = [...new Set(reps.map((r) => r.consultId))];
  const recentRows = await d.select().from(consults).where(ne(consults.status, "PAYING")).orderBy(desc(consults.createdAt)).limit(60);
  const reportCons = cIds.length ? await d.select().from(consults).where(inArray(consults.id, cIds)) : [];
  const allCons = new Map([...recentRows, ...reportCons].map((c) => [c.id, c]));
  const blocks = await d.select().from(consultBlocks).orderBy(desc(consultBlocks.createdAt));
  const people = await usersByIds([...new Set([...allCons.values()].flatMap((c) => [c.soloId, c.trainerId ?? ""]).concat(reps.map((r) => r.reporterId), blocks.map((b) => b.userId)).filter(Boolean))]);
  const who = new Map(people.map((p) => [p.id, p]));
  const reports: AdminReport[] = [];
  for (const r of reps) {
    const c = allCons.get(r.consultId);
    if (!c) continue;
    let details = "";
    try {
      details = decryptJson<{ details: string }>(r.detailsEnc, aadR(r.id)).details;
    } catch {
      /* unreadable */
    }
    const role = r.reporterRole as ReporterRole;
    const facts = await factsFor(c);
    reports.push({
      id: r.id,
      consultId: c.id,
      reporterRole: role,
      reporterName: nameOf(who.get(r.reporterId)),
      reason: r.reason,
      reasonLabel: reasonLabel(role, r.reason),
      details,
      createdAt: r.createdAt.toISOString(),
      status: r.status,
      resolution: r.resolution ? (JSON.parse(r.resolution) as AdminReport["resolution"]) : null,
      trainer: c.trainerId ? { id: c.trainerId, name: nameOf(who.get(c.trainerId)) } : null,
      person: { id: c.soloId, name: nameOf(who.get(c.soloId)) },
      consult: { status: c.status, priceCents: c.priceCents, refundedCents: c.refundedCents, trainerCents: c.trainerCents, payoutStatus: c.payoutStatus, acceptedAt: c.acceptedAt?.toISOString() ?? null, endedAt: c.endedAt?.toISOString() ?? null, endedBy: c.endedBy, question: secretOf(c).question },
      facts,
      recommendation: recommend(role, r.reason, facts),
    });
  }
  const reportedIds = new Set(reps.map((r) => r.consultId));
  const doneRows = await d.select().from(consults).where(inArray(consults.status, ["DONE", "LIVE"]));
  const grossCents = doneRows.reduce((a, c) => a + c.priceCents, 0);
  const refundedCents = doneRows.reduce((a, c) => a + c.refundedCents, 0);
  const trainerCents = doneRows.filter((c) => c.payoutStatus !== "CANCELLED").reduce((a, c) => a + c.trainerCents, 0);
  return {
    reports,
    recent: recentRows.map((c) => ({ id: c.id, status: c.status, createdAt: c.createdAt.toISOString(), person: nameOf(who.get(c.soloId)), trainer: c.trainerId ? nameOf(who.get(c.trainerId)) : null, priceCents: c.priceCents, refundedCents: c.refundedCents, trainerCents: c.trainerCents, payoutStatus: c.payoutStatus, stars: c.stars, reported: reportedIds.has(c.id) })),
    totals: { done: doneRows.length, grossCents, refundedCents, trainerCents, keptCents: grossCents - refundedCents - trainerCents },
    blocked: blocks.map((b) => ({ userId: b.userId, name: nameOf(who.get(b.userId)), role: who.get(b.userId)?.role === "CLIENT" ? "Client" : "Trainer", reason: b.reason, since: b.createdAt.toISOString() })),
    ready: consultsReady(),
  };
}

const SANCTIONS: Sanction[] = ["none", "warn_trainer", "suspend_trainer", "warn_person", "block_person"];
const REFUNDS: RefundChoice[] = ["none", "partial", "full"];

/** The owner decides a report: money (refund or pay the trainer) and any warning or suspension. Each step is safe to retry. */
export async function resolveReport(owner: UserRow, reportId: string, body: Record<string, unknown>): Promise<void> {
  if (owner.role !== "OWNER") throw forbidden();
  const d = await db();
  const [r] = await d.select().from(consultReports).where(eq(consultReports.id, String(reportId))).limit(1);
  if (!r) throw notFound("That report wasn't found.");
  if (r.status !== "OPEN") throw conflict("That report has already been decided.");
  const c = await get(r.consultId);
  if (!c) throw notFound("That consult wasn't found.");
  const refund = REFUNDS.find((x) => x === body.refund) ?? "none";
  const sanction = SANCTIONS.find((x) => x === body.sanction) ?? "none";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const left = c.priceCents - c.refundedCents;
  let refundCents = refund === "full" ? left : refund === "partial" ? Math.round(Number(body.refundCents)) : 0;
  if (refund === "partial" && (!Number.isFinite(refundCents) || refundCents < 100 || refundCents >= left)) throw badRequest(`A partial refund is from S$1 up to ${money(left - 100)}.`);
  if ((sanction === "warn_trainer" || sanction === "suspend_trainer") && !c.trainerId) throw badRequest("This consult has no trainer.");
  refundCents = Math.max(0, Math.min(left, refundCents));

  if (refundCents > 0) {
    if (!c.paymentIntentId) throw badRequest("There is no card payment to refund on this consult.");
    await stripe().refunds.create({ payment_intent: c.paymentIntentId, amount: refundCents, metadata: { consultId: c.id, reportId: r.id } }, { idempotencyKey: `consult_refund_${r.id}` });
    const refunded = c.refundedCents + refundCents;
    const newShare = trainerShare(c.priceCents - refunded);
    // Already paid out (a late report decided anyway): take the trainer's part of the refund back from the transfer.
    if (c.payoutStatus === "PAID" && c.transferId && c.trainerCents > newShare) {
      await stripe().transfers.createReversal(c.transferId, { amount: c.trainerCents - newShare }, { idempotencyKey: `consult_reversal_${r.id}` }).catch((e) => console.error("transfer reversal failed", e instanceof Error ? e.message : e));
    }
    await d
      .update(consults)
      .set({ refundedCents: refunded, trainerCents: newShare, ...(newShare === 0 && c.payoutStatus === "HELD" ? { payoutStatus: "CANCELLED" } : {}), updatedAt: new Date() })
      .where(eq(consults.id, c.id));
  }

  if (sanction === "suspend_trainer" && c.trainerId) {
    await d.insert(consultBlocks).values({ userId: c.trainerId, reason: note || reasonLabel(r.reporterRole as ReporterRole, r.reason) }).onConflictDoNothing();
    await d.update(coachPublic).set({ takesConsults: false, updatedAt: new Date() }).where(eq(coachPublic.coachId, c.trainerId));
  }
  if (sanction === "block_person") await d.insert(consultBlocks).values({ userId: c.soloId, reason: note || reasonLabel(r.reporterRole as ReporterRole, r.reason) }).onConflictDoNothing();

  // A call still running when the owner refunds it in full or stops one of them is closed now.
  if (c.status === "LIVE" && (refund === "full" || sanction === "suspend_trainer" || sanction === "block_person")) {
    const now = new Date();
    await d.update(consults).set({ status: "DONE", endedAt: now, payoutDueAt: now, updatedAt: now }).where(and(eq(consults.id, c.id), eq(consults.status, "LIVE")));
    if (c.roomName) await deleteRoom(c.roomName);
  }

  const upheld = refundCents > 0 || sanction !== "none";
  const decided = await d
    .update(consultReports)
    .set({ status: "RESOLVED", resolution: JSON.stringify({ refund, refundCents, sanction, note }), upheld, resolvedAt: new Date() })
    .where(and(eq(consultReports.id, r.id), eq(consultReports.status, "OPEN")))
    .returning({ id: consultReports.id });
  if (!decided.length) return;

  // Tell the people involved, in plain words.
  const toReporter = refundCents > 0 && r.reporterRole === "SOLO" ? `We've refunded ${money(refundCents)} to your card (it can take 5 to 10 days to show).` : r.reporterRole === "TRAINER" && refundCents === 0 ? "Your share of the consult will be paid as usual." : "We've looked into it and decided.";
  await notify([r.reporterId], "consult_report_done", { title: "We looked into your report", body: `${toReporter}${note ? ` ${note}` : ""}`, link: "/consult" });
  if (refundCents > 0 && r.reporterRole === "TRAINER") await notify([c.soloId], "consult_refund", { title: `${money(refundCents)} refunded`, body: "Part of your consult payment was refunded to your card.", link: "/consult" });
  if (sanction === "warn_trainer" && c.trainerId) await notify([c.trainerId], "consult_warning", { title: "A note about a consult", body: note || "We received a report about one of your consults. Please make sure every consult gets your full attention for the hour.", link: "/consult" });
  if (sanction === "suspend_trainer" && c.trainerId) await notify([c.trainerId], "consult_suspended", { title: "Consults paused for your account", body: `After a report, you can't take consults for now.${note ? ` ${note}` : ""} Reply to CoachFlow support to talk about it.`, link: "/consult" });
  if (sanction === "warn_person") await notify([c.soloId], "consult_warning", { title: "A note about your consult", body: note || "We received a report about your consult. Please be respectful to trainers.", link: "/consult" });
  if (sanction === "block_person") await notify([c.soloId], "consult_blocked", { title: "Consults paused for your account", body: `After a report, you can't book consults for now.${note ? ` ${note}` : ""} Contact CoachFlow support to talk about it.`, link: "/consult" });

  // With no other open report, the payout goes ahead when it is due.
  await sweep(true);
}

/** Lifts a suspension or block. */
export async function unblock(owner: UserRow, userId: string): Promise<void> {
  if (owner.role !== "OWNER") throw forbidden();
  const d = await db();
  await d.delete(consultBlocks).where(eq(consultBlocks.userId, String(userId)));
}
