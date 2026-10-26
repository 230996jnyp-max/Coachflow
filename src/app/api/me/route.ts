import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { openProfile, sealProfile } from "@/lib/server/accounts";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { badRequest, forbidden, readJson, route } from "@/lib/server/http";
import { applyHomeAddress } from "@/lib/server/schedule";
import { users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { unit?, hasCompletedOnboarding?, themePreference?, homeAddress? } — personal preferences (homeAddress: a client's own home, { place } | { text } | null). */
export const PATCH = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  const set: { unit?: string; onboarded?: boolean; theme?: string; profileEnc?: string; updatedAt: Date } = { updatedAt: new Date() };
  if ("unit" in body) {
    if (body.unit !== "metric" && body.unit !== "imperial") throw badRequest("Unit must be metric or imperial.");
    set.unit = body.unit;
  }
  if ("hasCompletedOnboarding" in body) {
    if (typeof body.hasCompletedOnboarding !== "boolean") throw badRequest("hasCompletedOnboarding must be true or false.");
    set.onboarded = body.hasCompletedOnboarding;
  }
  if ("themePreference" in body) {
    if (body.themePreference !== "black" && body.themePreference !== "white" && body.themePreference !== "navy") throw badRequest("Unknown theme.");
    set.theme = body.themePreference;
  }
  if ("homeAddress" in body) {
    if (me.role !== "CLIENT") throw forbidden("Home addresses belong to clients.");
    const p = openProfile(me);
    applyHomeAddress(p, body.homeAddress);
    set.profileEnc = sealProfile(me.id, p);
  }
  if (set.unit === undefined && set.onboarded === undefined && set.theme === undefined && set.profileEnc === undefined) throw badRequest("Nothing to change.");
  const d = await db();
  await d.update(users).set(set).where(eq(users.id, me.id));
  return NextResponse.json({ ok: true });
});
