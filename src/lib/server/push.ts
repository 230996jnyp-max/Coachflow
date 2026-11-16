import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import * as webpush from "web-push";
import { inQuietHoursIn, parsePrefs } from "@/lib/prefs";
import { db, isLocalTestMode } from "./db";
import { badRequest } from "./http";
import { pushSubscriptions, users, type UserRow } from "./schema";

/*
 * Push notifications to a phone or browser that has CoachFlow installed or open in the background (Web Push, VAPID).
 *  - A person turns "Phone notifications" on per device (Settings, Notifications): the browser hands us a subscription, we keep it.
 *  - Every in-app notification and every new chat message also goes out as a push, except inside the person's quiet hours.
 *  - Nothing private goes in a push: chat pushes say who wrote, never what; the rest reuse the notification's own title and short body.
 *  - A device that has gone away (the push service answers 404 or 410) is forgotten automatically.
 * Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto: address). Without them it does nothing, and the settings page says so.
 * Local testing: PUSH_FAKE=1 (with LOCAL_PGLITE=1) keeps pushes in memory instead of sending them.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping it goes (a path inside the app). */
  url?: string;
  /** Pushes with the same tag replace each other on the device (e.g. one per chat thread). */
  tag?: string;
}

const fakeMode = (): boolean => isLocalTestMode() && process.env.PUSH_FAKE === "1";
export const pushConfigured = (): boolean => fakeMode() || !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = (): string | null => process.env.VAPID_PUBLIC_KEY || (fakeMode() ? "BFakePublicKeyForLocalTestingOnly" : null);

/** Local testing only: what would have been sent. */
export const fakeOutbox: { userId: string; endpoint: string; payload: PushPayload; at: string }[] = [];

let vapidReady = false;
function setup(): boolean {
  if (fakeMode()) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@coachflow.pro", pub, priv);
    vapidReady = true;
  }
  return true;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Checks what the browser sent. An endpoint must be a real https address; the keys are base64url text. */
export function parseSubscription(x: unknown): SubscriptionInput {
  const s = (x ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof s.endpoint === "string" ? s.endpoint.trim() : "";
  const p256dh = typeof s.keys?.p256dh === "string" ? s.keys.p256dh.trim() : "";
  const auth = typeof s.keys?.auth === "string" ? s.keys.auth.trim() : "";
  const okEndpoint = /^https:\/\/[^\s]{8,1000}$/.test(endpoint) || (isLocalTestMode() && /^http:\/\/localhost[:/][^\s]{0,500}$/.test(endpoint));
  if (!okEndpoint) throw badRequest("That doesn't look like a push address from your browser.");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) throw badRequest("The push keys from your browser look wrong.");
  return { endpoint, keys: { p256dh, auth } };
}

const MAX_DEVICES = 8;

export async function savePushSubscription(user: UserRow, sub: SubscriptionInput, userAgent: string | null): Promise<void> {
  const d = await db();
  // The same device may have been used by someone else before (a shared phone): the newest sign-in owns it.
  await d.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
  const mine = await d.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
  if (mine.length >= MAX_DEVICES) {
    const oldest = [...mine].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, mine.length - MAX_DEVICES + 1);
    await d.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, oldest.map((o) => o.id)));
  }
  await d.insert(pushSubscriptions).values({ id: `ps_${randomUUID().replace(/-/g, "").slice(0, 24)}`, userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent ? userAgent.slice(0, 200) : null });
}

export async function removePushSubscription(user: UserRow, endpoint: string): Promise<void> {
  const d = await db();
  await d.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
}

/** Signing out: this device stops getting this person's notifications. */
export async function removePushForEndpoint(endpoint: string): Promise<void> {
  const d = await db();
  await d.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function deviceCount(userId: string): Promise<number> {
  const d = await db();
  return (await d.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))).length;
}

/**
 * Sends a push to every device of these people (skipping anyone in quiet hours unless `force`). Never throws and never waits on a slow
 * push service for more than a few seconds, so it is safe to call from the middle of a request. Returns how many devices it reached.
 */
export async function sendPush(userIds: string[], payload: PushPayload, opts: { force?: boolean } = {}): Promise<number> {
  try {
    if (!setup()) return 0;
    const ids = [...new Set(userIds)];
    if (!ids.length) return 0;
    const d = await db();
    const subs = await d.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, ids));
    if (!subs.length) return 0;

    let allowed = new Set(ids);
    if (!opts.force) {
      const rows = await d.select({ id: users.id, prefs: users.prefs, active: users.active }).from(users).where(inArray(users.id, ids));
      const tz = process.env.APP_TZ || undefined;
      allowed = new Set(rows.filter((r) => r.active && !inQuietHoursIn(parsePrefs(r.prefs).quiet ?? null, new Date(), tz)).map((r) => r.id));
    }
    const body = JSON.stringify({ title: clip(payload.title, 80), body: clip(payload.body, 180), url: payload.url?.startsWith("/") ? payload.url : "/", ...(payload.tag ? { tag: payload.tag.slice(0, 60) } : {}) });

    let reached = 0;
    const gone: string[] = [];
    await Promise.all(
      subs
        .filter((s) => allowed.has(s.userId))
        .map(async (s) => {
          if (fakeMode()) {
            fakeOutbox.push({ userId: s.userId, endpoint: s.endpoint, payload: JSON.parse(body) as PushPayload, at: new Date().toISOString() });
            reached++;
            return;
          }
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600, urgency: "normal", timeout: 8000 });
            reached++;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) gone.push(s.id);
            else console.error("push failed", code ?? (e instanceof Error ? e.message : e));
          }
        }),
    );
    if (gone.length) await d.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
    if (reached) await d.update(pushSubscriptions).set({ lastSentAt: new Date() }).where(and(inArray(pushSubscriptions.userId, [...allowed]), inArray(pushSubscriptions.endpoint, subs.map((s) => s.endpoint))));
    return reached;
  } catch (e) {
    console.error("sendPush failed", e);
    return 0;
  }
}
