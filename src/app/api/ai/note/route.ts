import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { aiConfigured, aiShortNote } from "@/lib/server/ai";
import { logAiUsage } from "@/lib/server/aiLog";
import { takeAiQuota } from "@/lib/server/aiQuota";
import { requireUser } from "@/lib/server/auth";
import { isMinorRow } from "@/lib/server/accounts";
import { db } from "@/lib/server/db";
import { readJson, route, str } from "@/lib/server/http";
import { aiNotes } from "@/lib/server/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST { kind: "why" | "eye", facts } — one short plain-English sentence for a training suggestion or a client brief. The sentence is
 * kept, so the same facts are only ever written once. Always answers: `text` is null when the AI isn't available (the screen then
 * simply shows its own wording).
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser();
  if (isMinorRow(me)) return NextResponse.json({ text: null });
  const kind = body.kind === "eye" ? "eye" : "why";
  if (kind === "eye" && me.role === "CLIENT") return NextResponse.json({ text: null });
  const facts = str(body.facts, "Facts", { max: 1200 });
  const key = createHash("sha1").update(`${kind}|${facts}`).digest("hex");
  const d = await db();
  const [hit] = await d.select().from(aiNotes).where(eq(aiNotes.key, key)).limit(1);
  if (hit) return NextResponse.json({ text: hit.text });
  if (!aiConfigured()) return NextResponse.json({ text: null });
  try {
    await takeAiQuota(me.id, "note", 40, "AI explanations");
  } catch {
    return NextResponse.json({ text: null });
  }
  await logAiUsage({ userId: me.id, feature: "progression" });
  const text = await aiShortNote(kind, facts);
  if (text) await d.insert(aiNotes).values({ key, text }).onConflictDoNothing();
  return NextResponse.json({ text });
});
