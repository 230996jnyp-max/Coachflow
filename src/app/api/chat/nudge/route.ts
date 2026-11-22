import { NextResponse } from "next/server";
import { loadClientFor } from "@/lib/server/accounts";
import { requireUser } from "@/lib/server/auth";
import { displayName } from "@/lib/server/chat";
import { pushNewMessage, storeMessages } from "@/lib/server/chatSend";
import { badRequest, readJson, route, str } from "@/lib/server/http";
import { hit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_CLIENTS = 50;
/** A client is nudged at most once in this long, so a double tap (or two coaches' devices) never doubles up. */
const NUDGE_GAP_MS = 6 * 3_600_000;

/** "Ben" from "Ben Andrew". */
const firstOf = (full: string) => full.trim().split(/\s+/)[0] || "there";

/**
 * POST { clientIds, text } — a coach nudges several of their own clients at once. Each client gets the message privately in their
 * own chat with the coach (never a group message), with {first_name} filled in. In the app only: no email, so a big nudge never
 * eats into the daily email limit. Anyone who is not this coach's active client is skipped; a client nudged in the last 6 hours is
 * skipped too.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const me = await requireUser(["OWNER", "COACH"]);
  const text = str(body.text, "Message", { max: 600 });
  if (!Array.isArray(body.clientIds) || body.clientIds.length === 0) throw badRequest("Pick at least one client.");
  const ids = [...new Set(body.clientIds.filter((x): x is string => typeof x === "string"))].slice(0, MAX_CLIENTS);
  if (ids.length === 0) throw badRequest("Pick at least one client.");
  await hit(`nudge:${me.id}`, 12, 3_600_000, "You've sent a lot of nudges this hour. Try again a little later.");

  const entries: { thread: string; text: string; email: { status: "off" } }[] = [];
  const skipped: { clientId: string; reason: string }[] = [];
  for (const id of ids) {
    const row = await loadClientFor(me, id);
    if (!row || !row.active || row.coachId !== me.id) {
      skipped.push({ clientId: id, reason: "not your active client" });
      continue;
    }
    try {
      await hit(`nudge-to:${me.id}:${id}`, 1, NUDGE_GAP_MS);
    } catch {
      skipped.push({ clientId: id, reason: "nudged recently" });
      continue;
    }
    entries.push({ thread: `c:${id}`, text: text.replaceAll("{first_name}", firstOf(displayName(row))), email: { status: "off" } });
  }
  const messages = entries.length ? await storeMessages(entries, me) : [];
  for (const e of entries) pushNewMessage(me, [e.thread.slice(2)], e.thread);
  return NextResponse.json({ sent: entries.length, skipped, messages });
});
