import { and, desc, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { route } from "@/lib/server/http";
import { users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "coach" | "personal" | "client";

/**
 * GET — owner-only sign-up overview. Counts and dates only: no names, emails or profile data are selected or decrypted.
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

  const recent = await d
    .select({ kind: kindSql, verified: users.emailVerified, active: users.active, createdAt: users.createdAt })
    .from(users)
    .where(ne(users.role, "OWNER"))
    .orderBy(desc(users.createdAt))
    .limit(25);

  const [waiting] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(isNotNull(users.trialEndsAt), isNull(users.coachId), sql`${users.emailVerified} = false`));

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
    days,
    recent: recent.map((r) => ({ kind: r.kind, verified: r.verified, active: r.active, createdAt: r.createdAt.toISOString() })),
  });
});
