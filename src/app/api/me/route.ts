import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { applyGoalFields, openProfile, parseUsername, sealProfile, setUsername, type ProfileJson } from "@/lib/server/accounts";
import { isStaff, requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { badRequest, forbidden, readJson, route } from "@/lib/server/http";
import { savePrefs } from "@/lib/server/media";
import { applyHomeAddress } from "@/lib/server/schedule";
import { users } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH { unit?, hasCompletedOnboarding?, themePreference?, homeAddress?, goalInfo?, username? } — personal preferences
 * (homeAddress: a client's own home, { place } | { text } | null; goalInfo: { personalGoal?, goalEventName?, goalEventDate?, weeklyTarget? },
 * where only someone without a coach may set weeklyTarget).
 */
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
  // Both of these edit the client's own sealed profile, so open it once and seal it once.
  let profile: ProfileJson | null = null;
  if ("homeAddress" in body) {
    if (me.role !== "CLIENT") throw forbidden("Home addresses belong to clients.");
    profile ??= openProfile(me);
    applyHomeAddress(profile, body.homeAddress);
  }
  if ("goalInfo" in body) {
    if (me.role !== "CLIENT") throw forbidden("Goals belong to clients.");
    const g = body.goalInfo;
    if (!g || typeof g !== "object" || Array.isArray(g)) throw badRequest("Goal details are missing.");
    // Someone with a coach has their weekly target set by that coach.
    if ("weeklyTarget" in g && me.coachId) throw forbidden("Your coach sets your weekly target.");
    profile ??= openProfile(me);
    applyGoalFields(profile, g as Record<string, unknown>);
  }
  if (profile) set.profileEnc = sealProfile(me.id, profile);
  let prefsSaved = false;
  if ("prefs" in body) {
    if (!body.prefs || typeof body.prefs !== "object" || Array.isArray(body.prefs)) throw badRequest("Preferences are missing.");
    await savePrefs(me, body.prefs as Record<string, unknown>);
    prefsSaved = true;
  }
  if ("username" in body) {
    const username = parseUsername(body.username, isStaff(me));
    if (username !== me.username) await setUsername(me.id, username);
    if (set.unit === undefined && set.onboarded === undefined && set.theme === undefined && set.profileEnc === undefined) return NextResponse.json({ ok: true, username });
  }
  if (set.unit === undefined && set.onboarded === undefined && set.theme === undefined && set.profileEnc === undefined) {
    if (prefsSaved) return NextResponse.json({ ok: true });
    throw badRequest("Nothing to change.");
  }
  const d = await db();
  await d.update(users).set(set).where(eq(users.id, me.id));
  return NextResponse.json({ ok: true });
});
