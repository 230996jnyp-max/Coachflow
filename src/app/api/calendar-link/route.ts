import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { decrypt, encrypt } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { assertSameOrigin, route } from "@/lib/server/http";
import { calendarTokens } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function linkFor(userId: string, regenerate: boolean, req: Request) {
  const d = await db();
  let token: string | null = null;
  if (!regenerate) {
    const [row] = await d.select().from(calendarTokens).where(eq(calendarTokens.userId, userId)).limit(1);
    if (row) {
      try {
        token = decrypt(row.tokenEnc, `calendar:${userId}`);
      } catch {
        token = null;
      }
    }
  }
  if (!token) {
    token = randomBytes(32).toString("base64url");
    const values = { userId, tokenHash: hashToken(token), tokenEnc: encrypt(token, `calendar:${userId}`), createdAt: new Date() };
    await d.insert(calendarTokens).values(values).onConflictDoUpdate({ target: calendarTokens.userId, set: values });
  }
  const url = new URL(process.env.APP_URL || req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const path = `/api/calendar/${token}.ics`;
  return { https: `${proto}://${host}${path}`, webcal: `webcal://${host}${path}` };
}

/** GET — the coach's private calendar-subscription link (created on first use). */
export const GET = route(async (req) => {
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json(await linkFor(me.id, false, req));
});

/** POST — issue a new link; the old one stops working immediately. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const me = await requireUser(["OWNER", "COACH"]);
  return NextResponse.json(await linkFor(me.id, true, req));
});
