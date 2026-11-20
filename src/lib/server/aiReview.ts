import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray, and, ne } from "drizzle-orm";
import { SEED_EXERCISES } from "@/data/exercises";
import { casesForMonth, cleanAnswers, DISCOUNT_PERCENT, monthOf, reviewFlags, rulesFromAnswers, CASES_PER_REVIEW, type CaseAnswer, type ReviewCase } from "@/lib/aiReview";
import { coveredByGym, ensureBilling, stripe, stripeReady } from "./billing";
import { db } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { notify } from "./groups";
import { activeRules } from "./aiTrainer";
import { aiReviewCredits, aiReviews, aiRules, coachBilling, users, type AiReviewRow, type UserRow } from "./schema";

/*
 * The coaches' monthly AI review (see lib/aiReview.ts). The five made-up profiles are fixed when the coach starts (stored with the
 * review), so what they read is what the owner later checks. A review that passes the automatic checks is approved at once; one that
 * does not is held for the owner. Approving creates rules for the AI trainer and gives the coach DISCOUNT_PERCENT% off their next invoice.
 */

interface Snapshot {
  cases: ReviewCase[];
  answers: CaseAnswer[];
}

const emptySnap = (): Snapshot => ({ cases: [], answers: [] });
function openSnap(row: AiReviewRow): Snapshot {
  try {
    const v = JSON.parse(row.answers) as Partial<Snapshot>;
    return { cases: Array.isArray(v.cases) ? v.cases : [], answers: Array.isArray(v.answers) ? v.answers : [] };
  } catch {
    return emptySnap();
  }
}
const parseList = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const exName = new Map(SEED_EXERCISES.map((e) => [e.id, e.name]));

export type ReviewStatus = "NONE" | "STARTED" | "SUBMITTED" | "APPROVED" | "REJECTED";

export interface DiscountInfo {
  percent: number;
  /** What an approved review does for this coach. */
  kind: "STRIPE_CREDIT" | "PENDING" | "EXEMPT" | "GYM";
  text: string;
}

export interface ReviewView {
  month: string;
  status: ReviewStatus;
  /** The five profiles to read (while the review is still open). */
  cases: ReviewCase[];
  flags: string[];
  decisionNote: string;
  discountNote: string;
  discount: DiscountInfo;
  history: { month: string; status: string; discountKind: string | null }[];
  /** How many rules this coach's approved reviews have taught the AI trainer. */
  rulesTaught: number;
}

async function discountInfo(coachId: string): Promise<DiscountInfo> {
  const b = await ensureBilling({ id: coachId });
  if (b.exempt) return { percent: DISCOUNT_PERCENT, kind: "EXEMPT", text: "Your account has free access, so there is no bill to reduce. Your review still helps the AI trainer, thank you." };
  if (await coveredByGym(coachId)) return { percent: DISCOUNT_PERCENT, kind: "GYM", text: "Your gym covers your CoachFlow account, so there is no bill to reduce. Your review still helps the AI trainer, thank you." };
  if (b.stripeCustomerId && b.stripeSubscriptionId && b.status !== "CANCELED") return { percent: DISCOUNT_PERCENT, kind: "STRIPE_CREDIT", text: `${DISCOUNT_PERCENT}% off your next invoice, as a credit on your account.` };
  return { percent: DISCOUNT_PERCENT, kind: "PENDING", text: `${DISCOUNT_PERCENT}% off your first invoice. It is saved for you and comes off once you subscribe.` };
}

async function rowFor(coachId: string, month: string): Promise<AiReviewRow | null> {
  const d = await db();
  const [row] = await d.select().from(aiReviews).where(and(eq(aiReviews.coachId, coachId), eq(aiReviews.month, month))).limit(1);
  return row ?? null;
}

export async function reviewView(me: UserRow): Promise<ReviewView> {
  const month = monthOf();
  const row = await rowFor(me.id, month);
  const d = await db();
  const hist = await d.select({ month: aiReviews.month, status: aiReviews.status, discountKind: aiReviews.discountKind }).from(aiReviews).where(and(eq(aiReviews.coachId, me.id), ne(aiReviews.status, "STARTED"))).orderBy(desc(aiReviews.month)).limit(6);
  const mine = await d.select({ id: aiRules.id }).from(aiRules).where(eq(aiRules.coachId, me.id));
  const snap = row ? openSnap(row) : emptySnap();
  const open = !row || row.status === "STARTED";
  return {
    month,
    status: (row?.status as ReviewStatus) ?? "NONE",
    // The planted mistake is never sent to the coach: it would give the attention check away.
    cases: open
      ? snap.cases.map((c) => {
          const shown: ReviewCase = { ...c };
          delete shown.hazardExerciseId;
          return shown;
        })
      : [],
    flags: row ? parseList(row.flags) : [],
    decisionNote: row?.decisionNote ?? "",
    discountNote: row?.discountNote ?? "",
    discount: await discountInfo(me.id),
    history: hist,
    rulesTaught: mine.length,
  };
}

/** Starts this month's review: fixes the five profiles and the clock. Doing it again returns the same review. */
export async function startReview(me: UserRow): Promise<ReviewView> {
  const month = monthOf();
  const existing = await rowFor(me.id, month);
  if (!existing) {
    const rules = await activeRules();
    const snap: Snapshot = { cases: casesForMonth(month, SEED_EXERCISES, rules), answers: [] };
    const d = await db();
    await d.insert(aiReviews).values({ id: `rv_${randomUUID().replace(/-/g, "").slice(0, 20)}`, coachId: me.id, month, answers: JSON.stringify(snap) }).onConflictDoNothing();
  }
  return reviewView(me);
}

async function ownerIds(): Promise<string[]> {
  const d = await db();
  return (await d.select({ id: users.id }).from(users).where(eq(users.role, "OWNER"))).map((u) => u.id);
}

export async function submitReview(me: UserRow, rawAnswers: unknown): Promise<ReviewView & { approved: boolean }> {
  const month = monthOf();
  const row = await rowFor(me.id, month);
  if (!row) throw badRequest("Open this month's review first.");
  if (row.status !== "STARTED") throw conflict("You have already sent this month's review.");
  const snap = openSnap(row);
  if (snap.cases.length !== CASES_PER_REVIEW) throw badRequest("This review can't be read. Please open it again next month.");
  const cleaned = cleanAnswers(rawAnswers, snap.cases);
  if (!cleaned.ok) throw badRequest(cleaned.error);
  const seconds = Math.max(0, Math.round((Date.now() - row.startedAt.getTime()) / 1000));
  const flags = reviewFlags(snap.cases, cleaned.answers, seconds);
  const d = await db();
  const claimed = await d
    .update(aiReviews)
    .set({ status: "SUBMITTED", answers: JSON.stringify({ cases: snap.cases, answers: cleaned.answers }), flagged: flags.length > 0, flags: JSON.stringify(flags), seconds, submittedAt: new Date() })
    .where(and(eq(aiReviews.id, row.id), eq(aiReviews.status, "STARTED")))
    .returning({ id: aiReviews.id });
  if (claimed.length === 0) throw conflict("You have already sent this month's review.");
  if (flags.length === 0) {
    await decide(row.id, "APPROVED", { by: "AUTO" });
  } else {
    const owners = await ownerIds();
    await notify(owners, "ai_review_flagged", { title: "An AI review needs a look", body: `A coach's monthly AI review was held for checking: ${flags.join("; ")}.`, link: "/admin" });
  }
  const view = await reviewView(me);
  return { ...view, approved: view.status === "APPROVED" };
}

/* ---------------- Approving, rejecting, the discount ---------------- */
async function monthsCreditCents(tierCents: number): Promise<number> {
  return Math.max(1, Math.round((tierCents * DISCOUNT_PERCENT) / 100));
}

/** Gives the coach their discount. Never throws: a Stripe hiccup is recorded as PENDING and retried when they next subscribe or pay. */
async function grantDiscount(coachId: string, reviewId: string): Promise<{ kind: string; note: string; told: string }> {
  const info = await discountInfo(coachId);
  const d = await db();
  if (info.kind === "EXEMPT" || info.kind === "GYM") return { kind: info.kind, note: info.text, told: info.text };
  const b = await ensureBilling({ id: coachId });
  const id = `rc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  if (info.kind === "STRIPE_CREDIT" && b.stripeCustomerId && stripeReady()) {
    const cents = await monthsCreditCents(b.tierCents);
    try {
      await stripe().customers.createBalanceTransaction(b.stripeCustomerId, { amount: -cents, currency: "sgd", description: `CoachFlow AI review: ${DISCOUNT_PERCENT}% off (${reviewId})` });
      await d.insert(aiReviewCredits).values({ id, coachId, reviewId, cents, status: "APPLIED", appliedAt: new Date(), note: "Stripe credit" });
      return { kind: "STRIPE_CREDIT", note: `Credit of ${cents} cents SGD on their next invoice`, told: `${DISCOUNT_PERCENT}% off your next invoice has been credited to your account. Thank you for the review.` };
    } catch (e) {
      console.error("AI review credit failed", e instanceof Error ? e.message : e);
    }
  }
  // No subscription yet (or Stripe could not be reached): kept, and applied when they subscribe.
  await d.insert(aiReviewCredits).values({ id, coachId, reviewId, cents: 0, status: "PENDING", note: "Waiting for a subscription" });
  return { kind: "PENDING", note: "Saved until they subscribe", told: `${DISCOUNT_PERCENT}% off your first invoice is saved for you. Thank you for the review.` };
}

/** Called once a coach's subscription is paid: any discount waiting for them goes onto their Stripe account. */
export async function applyPendingReviewCredits(coachId: string): Promise<number> {
  const d = await db();
  const pending = await d.select().from(aiReviewCredits).where(and(eq(aiReviewCredits.coachId, coachId), eq(aiReviewCredits.status, "PENDING"))).limit(6);
  if (pending.length === 0 || !stripeReady()) return 0;
  const [b] = await d.select().from(coachBilling).where(eq(coachBilling.coachId, coachId)).limit(1);
  if (!b?.stripeCustomerId || b.exempt) return 0;
  let n = 0;
  for (const c of pending) {
    const cents = await monthsCreditCents(b.tierCents);
    try {
      await stripe().customers.createBalanceTransaction(b.stripeCustomerId, { amount: -cents, currency: "sgd", description: `CoachFlow AI review: ${DISCOUNT_PERCENT}% off (${c.reviewId})` });
      await d.update(aiReviewCredits).set({ status: "APPLIED", cents, appliedAt: new Date(), note: "Stripe credit (applied once subscribed)" }).where(eq(aiReviewCredits.id, c.id));
      n++;
    } catch (e) {
      console.error("pending AI review credit failed", e instanceof Error ? e.message : e);
    }
  }
  if (n > 0) await notify([coachId], "ai_review_credit", { title: "Your review discount is applied", body: `${n} review discount${n === 1 ? " has" : "s have"} been credited to your account and come off your next invoice.`, link: "/settings/ai-review" });
  return n;
}

async function decide(reviewId: string, status: "APPROVED" | "REJECTED", by: { by: string; note?: string }): Promise<void> {
  const d = await db();
  const [row] = await d.select().from(aiReviews).where(eq(aiReviews.id, reviewId)).limit(1);
  if (!row) throw notFound("Review not found.");
  if (row.status !== "SUBMITTED") throw conflict("This review has already been decided.");
  const claimed = await d
    .update(aiReviews)
    .set({ status, decidedAt: new Date(), decidedBy: by.by, decisionNote: (by.note ?? "").slice(0, 300) })
    .where(and(eq(aiReviews.id, reviewId), eq(aiReviews.status, "SUBMITTED")))
    .returning({ id: aiReviews.id });
  if (claimed.length === 0) throw conflict("This review has already been decided.");
  if (status === "REJECTED") {
    await notify([row.coachId], "ai_review_decided", { title: "Your AI review wasn't accepted", body: by.note ? `The owner said: ${by.note.slice(0, 200)}` : "The owner didn't accept this month's review, so no discount this time. You are welcome to do next month's.", link: "/settings/ai-review" });
    return;
  }
  const snap = openSnap(row);
  const rules = rulesFromAnswers(snap.cases, snap.answers);
  for (const r of rules) {
    await d.insert(aiRules).values({ id: `ar_${randomUUID().replace(/-/g, "").slice(0, 20)}`, reviewId, coachId: row.coachId, tags: JSON.stringify(r.tags), exerciseIds: JSON.stringify(r.exerciseIds), text: r.text });
  }
  const gift = await grantDiscount(row.coachId, reviewId);
  await d.update(aiReviews).set({ discountKind: gift.kind, discountNote: gift.note }).where(eq(aiReviews.id, reviewId));
  await notify([row.coachId], "ai_review_decided", { title: "Thank you for your AI review", body: `${rules.length} lesson${rules.length === 1 ? "" : "s"} added to the AI trainer. ${gift.told}`, link: "/settings/ai-review" });
}

/* ---------------- The owner ---------------- */
export interface OwnerReview {
  id: string;
  coachId: string;
  coachName: string;
  month: string;
  status: string;
  flagged: boolean;
  flags: string[];
  seconds: number;
  submittedAt: string | null;
  decisionNote: string;
  discountKind: string | null;
  cases: { title: string; verdict: string; removed: string[]; avoid: string; why: string; planted: boolean }[];
}

export interface OwnerRule {
  id: string;
  coachName: string;
  tags: string[];
  exercises: string[];
  text: string;
  active: boolean;
  createdAt: string;
}

export async function ownerOverview(): Promise<{ reviews: OwnerReview[]; rules: OwnerRule[] }> {
  const d = await db();
  const rows = await d.select().from(aiReviews).where(ne(aiReviews.status, "STARTED")).orderBy(desc(aiReviews.submittedAt)).limit(60);
  const rules = await d.select().from(aiRules).orderBy(desc(aiRules.createdAt)).limit(100);
  const ids = [...new Set([...rows.map((r) => r.coachId), ...rules.map((r) => r.coachId)])];
  const names = new Map<string, string>();
  if (ids.length) for (const u of await d.select({ id: users.id, name: users.name, username: users.username }).from(users).where(inArray(users.id, ids))) names.set(u.id, u.name ?? u.username);
  const held = (s: string) => (s === "SUBMITTED" ? 0 : 1);
  const reviews: OwnerReview[] = rows
    .map((r) => {
      const snap = openSnap(r);
      return {
        id: r.id,
        coachId: r.coachId,
        coachName: names.get(r.coachId) ?? "A coach",
        month: r.month,
        status: r.status,
        flagged: r.flagged,
        flags: parseList(r.flags),
        seconds: r.seconds,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        decisionNote: r.decisionNote,
        discountKind: r.discountKind,
        cases: snap.answers.map((a) => {
          const c = snap.cases.find((x) => x.id === a.caseId);
          return { title: c?.title ?? a.caseId, verdict: a.verdict, removed: a.removed.map((id) => exName.get(id) ?? id), avoid: a.avoid, why: a.why, planted: !!c?.hazardExerciseId && c.id === a.caseId };
        }),
      };
    })
    .sort((a, b) => held(a.status) - held(b.status));
  return {
    reviews,
    rules: rules.map((r) => ({ id: r.id, coachName: names.get(r.coachId) ?? "A coach", tags: parseList(r.tags), exercises: parseList(r.exerciseIds).map((id) => exName.get(id) ?? id), text: r.text, active: r.active, createdAt: r.createdAt.toISOString() })),
  };
}

export async function ownerDecide(owner: UserRow, id: string, approve: boolean, note: unknown): Promise<void> {
  await decide(id, approve ? "APPROVED" : "REJECTED", { by: owner.id, note: typeof note === "string" ? note.trim() : "" });
}

export async function ownerSetRule(id: string, active: boolean): Promise<void> {
  const d = await db();
  const done = await d.update(aiRules).set({ active }).where(eq(aiRules.id, id)).returning({ id: aiRules.id });
  if (done.length === 0) throw notFound("Rule not found.");
}
