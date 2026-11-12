import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { badRequest, email, readJson, route } from "@/lib/server/http";
import { hit, ipTag } from "@/lib/server/rateLimit";
import { aiWaitlist } from "@/lib/server/schema";
import { isDisposableEmail } from "@/lib/signupRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { email, interest?, website? } — public: ask to be told when the AI personal trainer is ready.
 * Stores the address once and answers the same way whether or not it was already there, so the list can't be probed.
 * `website` is a hidden field real people never fill in; a bot that does gets the same friendly answer and nothing is saved.
 */
export const POST = route(async (req) => {
  const body = await readJson(req, 1000);
  await hit(`waitlist:${ipTag(req)}`, 5, 3_600_000, "Too many tries. Please wait a while and try again.");
  if (typeof body.website === "string" && body.website.trim()) return NextResponse.json({ ok: true });
  const address = email(body.email, "Email");
  if (isDisposableEmail(address)) throw badRequest("Please use an email address you check regularly.");
  const interest = body.interest === "coach" ? "coach" : "train";
  const d = await db();
  await d.insert(aiWaitlist).values({ id: `wl_${randomUUID()}`, email: address, interest }).onConflictDoNothing();
  return NextResponse.json({ ok: true });
});
