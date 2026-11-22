/*
 * Phone notifications (Web Push), browser side. Per device: the person turns it on here, the browser gives us a subscription,
 * and the server keeps it (see lib/server/push.ts). A small per-person flag on this device remembers the choice, so the
 * subscription is re-linked after an inactivity sign-out but never handed to someone else who signs in on the same device.
 */

export type PushState = {
  /** This browser can do push at all (iPhone: only once CoachFlow is added to the Home Screen). */
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  /** This device has a live subscription. */
  subscribed: boolean;
};

const flagKey = (userId: string) => `coachflow-push:${userId}`;
const getFlag = (userId: string) => {
  try {
    return localStorage.getItem(flagKey(userId)) === "1";
  } catch {
    return false;
  }
};
const setFlag = (userId: string, on: boolean) => {
  try {
    if (on) localStorage.setItem(flagKey(userId), "1");
    else localStorage.removeItem(flagKey(userId));
  } catch {
    /* storage unavailable */
  }
};

export const pushSupported = (): boolean => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** iPhone and iPad only allow push for an installed (Home Screen) app. */
export function needsInstallForPush(): boolean {
  if (typeof navigator === "undefined") return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // The service worker is registered at startup in production; make sure it exists (and is ready) wherever push is turned on.
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function readPushState(): Promise<PushState> {
  if (!pushSupported()) return { supported: false, permission: "unsupported", subscribed: false };
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    subscribed = !!(await reg?.pushManager.getSubscription());
  } catch {
    subscribed = false;
  }
  return { supported: true, permission: Notification.permission, subscribed };
}

const b64ToBytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

async function post(method: "POST" | "DELETE", body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/push", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error };
  } catch {
    return { ok: false, error: "No connection. Try again." };
  }
}

/** Asks permission, subscribes this device and tells the server. Returns an error message, or null when it is on. */
export async function enablePush(userId: string, publicKey: string): Promise<string | null> {
  if (!pushSupported()) return "This browser doesn't support phone notifications.";
  const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (perm !== "granted") return perm === "denied" ? "Notifications are blocked for this site. Allow them in your browser's settings, then try again." : "Notifications weren't allowed.";
  try {
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    const r = await post("POST", { subscription: sub.toJSON() });
    if (!r.ok) return r.error ?? "Couldn't turn notifications on.";
    setFlag(userId, true);
    return null;
  } catch (e) {
    return e instanceof Error && e.message ? `Couldn't turn notifications on: ${e.message}` : "Couldn't turn notifications on.";
  }
}

/** Turns phone notifications off for this device. */
export async function disablePush(userId: string): Promise<void> {
  setFlag(userId, false);
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await post("DELETE", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } catch {
    /* already gone */
  }
}

/** Signing out on purpose: this device stops getting this person's notifications (an inactivity sign-out keeps them). */
export async function forgetPushOnSignOut(userId: string): Promise<void> {
  if (!pushSupported()) return;
  if (getFlag(userId)) await disablePush(userId);
}

/** At sign-in: if this person turned it on here, make sure the server still has this device linked to them. Quiet when it isn't on. */
export async function relinkPush(userId: string): Promise<void> {
  if (!pushSupported() || !getFlag(userId) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await post("POST", { subscription: sub.toJSON() });
  } catch {
    /* try again next time */
  }
}
