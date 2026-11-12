import { and, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { listPeople, recentActions } from "@/lib/server/accountAdmin";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { route } from "@/lib/server/http";
import { aiWaitlist, users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "coach" | "personal" | "client";

/**
 * GET — owner-only sign-up overview: counts per day and type, plus each account's contact details (name, email, phone, type, dates) so
 * the owner can recognise people. Workouts, notes, food logs, body data and photos are never read here.
 * A "Personal" account is a client with no coach; a "client" has a coach.
 */
export const GET = route(async () => {
  await requireUser(["OWNER"]);
  const d = await db();
  const kindSql = sql<Kind>`case when ${users.role} in ('OWNER','COACH') then 'coach' when ${users.coachId} is null then 'personal' else 'client' end`;

  const totals = await d
    .select({
      kind: kindSql,
      total: sql<number>`count(*)::int`,
      verified: sql<number>`count(*) filter (where ${users.emailVerified})::int`,
      trial: sql<number>`count(*) filter (where ${users.trialEndsAt} > now())::int`,
    })
    .from(users)
    .where(ne(users.role, "OWNER"))
    .groupBy(kindSql);

  const since = new Date(Date.now() - 13 * 86_400_000);
  since.setHours(0, 0, 0, 0);
  const daily = await d
    .select({ day: sql<string>`to_char(${users.createdAt} at time zone 'Asia/Singapore', 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(gte(users.createdAt, since), ne(users.role, "OWNER")))
    .groupBy(sql`1`);

  const [waiting] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(isNotNull(users.trialEndsAt), isNull(users.coachId), sql`${users.emailVerified} = false`));

  const [wl] = await d.select({ n: sql<number>`count(*)::int` }).from(aiWaitlist);

  const by = (k: Kind) => totals.find((t) => t.kind === k) ?? { total: 0, verified: 0, trial: 0 };
  const dayMap = new Map(daily.map((r) => [r.day, r.n]));
  const days: { day: string; n: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date(Date.now() - i * 86_400_000));
    days.push({ day, n: dayMap.get(day) ?? 0 });
  }

  return NextResponse.json({
    coaches: by("coach"),
    personal: by("personal"),
    clients: by("client"),
    unverified: waiting.n,
    waitlist: wl.n,
    days,
    people: await listPeople(500),
    actions: await recentActions(15),
  });
});
